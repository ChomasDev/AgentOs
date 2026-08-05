import assert from "node:assert/strict";
import test from "node:test";
import { CLIInput } from "../src/index.js";

test("keeps one session until a new conversation is requested", async () => {
  const input = new CLIInput({ args: ["hello"] });

  const first = await input.read();
  const second = await input.read();
  assert.equal(second.sessionId, first.sessionId);

  const nextSession = input.newSession();
  const third = await input.read();
  assert.equal(third.sessionId, nextSession);
  assert.notEqual(third.sessionId, first.sessionId);
});
