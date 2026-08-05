import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "@agent-os/database-sqlite";
import { DatabaseMemory } from "../src/index.js";

test("stores memory through the generic database interface", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const memory = new DatabaseMemory({ database: provider.scope("memory") });

  await memory.remember({
    id: "turn-1",
    kind: "working",
    content: "Remember the blue theme",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    sessionId: "chat-a",
    metadata: { role: "user" },
  });
  await memory.remember({
    id: "turn-2",
    kind: "semantic",
    content: { preference: "blue" },
    createdAt: new Date("2026-01-02T00:00:00Z"),
    userId: "user-a",
  });

  assert.equal((await memory.get("turn-1"))?.sessionId, "chat-a");
  assert.deepEqual(
    (await memory.recall({ text: "blue", order: "newest" })).map((entry) => entry.id),
    ["turn-2", "turn-1"],
  );
  assert.equal(await memory.clear({ sessionId: "chat-a" }), 1);
  assert.equal(await memory.get("turn-1"), undefined);
  await provider.close();
});
