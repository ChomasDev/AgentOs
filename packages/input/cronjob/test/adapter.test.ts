import assert from "node:assert/strict";
import test from "node:test";
import { CronjobAdapter } from "../src/index.js";

const context = {
  runId: "run-1",
  callId: "call-1",
  startedAt: new Date(),
};

test("shares cron storage between input and management action", async () => {
  const adapter = new CronjobAdapter({ databasePath: ":memory:" });
  const added = await adapter.execute({
    action: "add",
    name: "daily-test",
    cronExpression: "0 9 * * *",
    prompt: "Run the daily test",
  }, context);
  assert.equal(added.success, true);

  const listed = await adapter.execute({ action: "list" }, context);
  assert.equal(listed.success, true);
  if (!listed.success) return;
  assert.equal(listed.data.jobs.length, 1);
  assert.equal(listed.data.jobs[0]?.name, "daily-test");
  await adapter.close();
});
