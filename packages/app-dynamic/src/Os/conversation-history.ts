import { randomUUID } from "node:crypto";
import type { InputMessage, Memory, MemoryEntry } from "@agent-os/core/domain";

const CHAT_NAMESPACE = "chat-history";

export interface ConversationHistoryOptions {
  historyLimit?: number;
  memoryLimit?: number;
}

export class ConversationHistory {
  private readonly historyLimit: number;
  private readonly memoryLimit: number;

  constructor(
    private readonly memory: Memory,
    options: ConversationHistoryOptions = {},
  ) {
    this.historyLimit = Math.max(0, options.historyLimit ?? 20);
    this.memoryLimit = Math.max(0, options.memoryLimit ?? 10);
  }

  async contextualize(message: InputMessage): Promise<InputMessage> {
    const [history, memories] = await Promise.all([
      this.loadHistory(message.sessionId),
      this.loadRelevantMemories(message),
    ]);
    return {
      ...message,
      text: buildContext(message.text, history, memories),
      metadata: {
        ...message.metadata,
        originalText: message.text,
        historyEntries: history.length,
        memoryEntries: memories.length,
      },
    };
  }

  rememberUser(message: InputMessage): Promise<void> {
    return this.memory.remember({
      id: `chat-user-${message.id}`,
      kind: "working",
      content: message.text,
      createdAt: message.createdAt,
      userId: message.userId,
      sessionId: message.sessionId,
      metadata: { namespace: CHAT_NAMESPACE, role: "user", channel: message.channel },
    });
  }

  rememberAssistant(message: InputMessage, content: string): Promise<void> {
    return this.memory.remember({
      id: `chat-assistant-${message.id}-${randomUUID()}`,
      kind: "working",
      content,
      createdAt: new Date(),
      userId: message.userId,
      sessionId: message.sessionId,
      metadata: { namespace: CHAT_NAMESPACE, role: "assistant", channel: message.channel },
    });
  }

  clear(sessionId: string): Promise<number> {
    return this.memory.clear({
      sessionId,
      kinds: ["working"],
      metadata: { namespace: CHAT_NAMESPACE },
    });
  }

  private async loadHistory(sessionId: string): Promise<MemoryEntry[]> {
    if (this.historyLimit === 0) return [];
    const entries = await this.memory.recall({
      sessionId,
      kinds: ["working"],
      metadata: { namespace: CHAT_NAMESPACE },
      limit: this.historyLimit,
      order: "newest",
    });
    return [...entries].reverse();
  }

  private async loadRelevantMemories(
    message: InputMessage,
  ): Promise<readonly MemoryEntry[]> {
    if (this.memoryLimit === 0 || !message.userId) return [];
    return this.memory.recall({
      kinds: ["semantic", "episodic", "procedural"],
      userId: message.userId,
      limit: this.memoryLimit,
      order: "newest",
    });
  }
}

function buildContext(
  request: string,
  history: readonly MemoryEntry[],
  memories: readonly MemoryEntry[],
): string {
  if (history.length === 0 && memories.length === 0) return request;

  const sections: string[] = [];
  if (memories.length > 0) {
    sections.push(
      "Relevant memory:\n" +
        memories.map((entry) => `- ${renderContent(entry.content)}`).join("\n"),
    );
  }
  if (history.length > 0) {
    sections.push(
      "Conversation history:\n" +
        history
          .map((entry) => {
            const role = String(entry.metadata?.role ?? "message").toUpperCase();
            return `${role}: ${renderContent(entry.content)}`;
          })
          .join("\n"),
    );
  }
  sections.push(`Current request:\n${request}`);
  return sections.join("\n\n");
}

function renderContent(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}
