import assert from "node:assert/strict";
import test from "node:test";
import type {
  InputMessage,
  Memory,
  MemoryEntry,
  MemoryQuery,
} from "@agent-os/core/domain";
import { ConversationHistory } from "../src/Os/conversation-history.js";

test("loads chat history by session without leaking other sessions", async () => {
  const memory = new TestMemory();
  const history = new ConversationHistory(memory);
  const first = message("one", "session-1", "My name is Ada");

  assert.equal((await history.contextualize(first)).text, first.text);
  await history.rememberUser(first);
  await history.rememberAssistant(first, "Nice to meet you, Ada");
  await history.rememberUser(message("other", "session-2", "Secret"));

  const next = await history.contextualize(
    message("two", "session-1", "What is my name?"),
  );
  assert.match(next.text, /USER: My name is Ada/);
  assert.match(next.text, /ASSISTANT: Nice to meet you, Ada/);
  assert.match(next.text, /Current request:\nWhat is my name\?/);
  assert.doesNotMatch(next.text, /Secret/);
});

class TestMemory implements Memory {
  private entries: MemoryEntry[] = [];

  async remember(entry: MemoryEntry): Promise<void> {
    this.entries = this.entries.filter((item) => item.id !== entry.id);
    this.entries.push(entry);
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  async recall(query: MemoryQuery = {}): Promise<readonly MemoryEntry[]> {
    const entries = this.entries.filter((entry) => matches(entry, query));
    entries.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    if (query.order === "newest") entries.reverse();
    return entries.slice(0, query.limit ?? 100);
  }

  async forget(id: string): Promise<boolean> {
    const previous = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    return previous !== this.entries.length;
  }

  async clear(query: MemoryQuery = {}): Promise<number> {
    const removed = this.entries.filter((entry) => matches(entry, query));
    this.entries = this.entries.filter((entry) => !matches(entry, query));
    return removed.length;
  }
}

function matches(entry: MemoryEntry, query: MemoryQuery): boolean {
  if (query.sessionId && entry.sessionId !== query.sessionId) return false;
  if (query.userId && entry.userId !== query.userId) return false;
  if (query.kinds && !query.kinds.includes(entry.kind)) return false;
  return Object.entries(query.metadata ?? {}).every(
    ([key, value]) => entry.metadata?.[key] === value,
  );
}

function message(id: string, sessionId: string, text: string): InputMessage {
  return {
    id,
    channel: "test",
    sessionId,
    text,
    createdAt: new Date(),
  };
}
