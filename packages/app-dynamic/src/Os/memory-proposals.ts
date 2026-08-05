import { randomUUID } from "node:crypto";
import type {
  InputMessage,
  Memory,
  MemoryProposal,
} from "@agent-os/core/domain";

export async function persistMemoryProposals(
  memory: Memory,
  message: InputMessage,
  proposals: readonly MemoryProposal[] = [],
  log: (message: string) => void = console.log,
): Promise<void> {
  if (!message.userId) return;
  for (const proposal of proposals) {
    if (proposal.operation !== "remember") continue;
    const content = renderContent(proposal.content);
    if (await alreadyRemembered(memory, message, proposal.kind, content)) continue;
    await memory.remember({
      id: `user-memory-${randomUUID()}`,
      kind: proposal.kind,
      content,
      createdAt: new Date(),
      userId: message.userId,
      confidence: proposal.confidence,
      metadata: {
        namespace: "user-memory",
        reason: proposal.reason,
        sourceChannel: message.channel,
      },
    });
    log(`Added memory: ${content}`);
  }
}

async function alreadyRemembered(
  memory: Memory,
  message: InputMessage,
  kind: "semantic" | "episodic" | "procedural" | "working",
  content: string,
): Promise<boolean> {
  const matches = await memory.recall({
    kinds: [kind],
    text: content,
    userId: message.userId,
    limit: 10,
  });
  return matches.some(
    (entry) => renderContent(entry.content).toLowerCase() === content.toLowerCase(),
  );
}

function renderContent(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}
