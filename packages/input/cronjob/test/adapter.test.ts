import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "@agent-os/database-sqlite";
import { CronjobAdapter } from "../src/index.js";

const context = {
  runId: "run-1",
  callId: "call-1",
  startedAt: new Date(),
};

test("shares cron storage between input and management action", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const adapter = new CronjobAdapter({ database: provider.scope("cronjob") });
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
  await provider.close();
});

test("restores cron jobs from the configured database provider", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const first = new CronjobAdapter({ database: provider.scope("cronjob") });

  const added = await first.execute({
    action: "add",
    name: "persisted-job",
    cronExpression: "30 8 * * *",
    prompt: "Run from persisted storage",
  }, context);
  assert.equal(added.success, true);
  await first.close();

  const restored = new CronjobAdapter({ database: provider.scope("cronjob") });
  const listed = await restored.execute({ action: "list" }, context);
  assert.equal(listed.success, true);
  if (!listed.success) return;
  assert.equal(listed.data.jobs.length, 1);
  assert.equal(listed.data.jobs[0]?.name, "persisted-job");

  await restored.close();
  await provider.close();
});
