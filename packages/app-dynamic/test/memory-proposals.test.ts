import assert from "node:assert/strict";
import test from "node:test";
import type { Memory, MemoryEntry, MemoryQuery } from "@agent-os/core/domain";
import { persistMemoryProposals } from "../src/Os/memory-proposals.js";

class TestMemory implements Memory {
  readonly entries: MemoryEntry[] = [];
  async remember(entry: MemoryEntry) { this.entries.push(entry); }
  async get(id: string) { return this.entries.find((entry) => entry.id === id); }
  async recall(query: MemoryQuery = {}) {
    return this.entries.filter((entry) =>
      (!query.userId || entry.userId === query.userId) &&
      (!query.kinds || query.kinds.includes(entry.kind)) &&
      (!query.text || String(entry.content).toLowerCase().includes(query.text.toLowerCase()))
    );
  }
  async forget() { return false; }
  async clear() { return 0; }
}

test("persists and logs a user memory only once", async () => {
  const memory = new TestMemory();
  const logs: string[] = [];
  const message = {
    id: "message-1",
    channel: "cli",
    sessionId: "session-1",
    userId: "user-1",
    text: "I prefer concise answers",
    createdAt: new Date(),
  };
  const proposals = [{
    operation: "remember" as const,
    kind: "semantic" as const,
    content: "The user prefers concise answers.",
    reason: "Response preference",
    confidence: 0.95,
  }];

  await persistMemoryProposals(memory, message, proposals, (line) => logs.push(line));
  await persistMemoryProposals(memory, message, proposals, (line) => logs.push(line));

  assert.equal(memory.entries.length, 1);
  assert.equal(memory.entries[0]?.userId, "user-1");
  assert.deepEqual(logs, ["Added memory: The user prefers concise answers."]);
});
