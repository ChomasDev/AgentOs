import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityExecutionContext } from "@agent-os/core/domain";
import {
  MacOSControlCapability,
  type NativeCommandRunner,
} from "../src/index.js";

const context: CapabilityExecutionContext = {
  runId: "run-1",
  callId: "call-1",
  startedAt: new Date(),
};

test("constructs mouse movement and parses native JSON output", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: NativeCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '{"x":120,"y":240}', stderr: "" };
  };
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    runner,
  });

  const result = await capability.execute(
    { operation: "move_mouse", x: 120, y: 240 },
    context,
  );

  assert.deepEqual(calls[0]?.args.slice(-5), ["move", "120", "240", "left", "1"]);
  assert.deepEqual(result, { success: true, data: { x: 120, y: 240 } });
});

test("constructs a smooth coordinate drag for visual canvases", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: NativeCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return {
      stdout: JSON.stringify({
        fromX: 120,
        fromY: 240,
        toX: 480,
        toY: 360,
        button: "left",
        durationMs: 750,
        steps: 45,
      }),
      stderr: "",
    };
  };
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    runner,
  });

  const result = await capability.execute(
    {
      operation: "drag",
      fromX: 120,
      fromY: 240,
      toX: 480,
      toY: 360,
      durationMs: 750,
      steps: 45,
    },
    context,
  );

  assert.deepEqual(
    calls[0]?.args.slice(-8),
    ["drag", "120", "240", "480", "360", "750", "45", "left"],
  );
  assert.equal(result.success, true);
});

test("rejects drag coordinates that are missing", async () => {
  let called = false;
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    runner: async () => {
      called = true;
      return { stdout: "{}", stderr: "" };
    },
  });

  const result = await capability.execute(
    { operation: "drag", fromX: 10, fromY: 20, toX: 30 },
    context,
  );

  assert.equal(called, false);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
    assert.match(result.error.message, /toY/);
  }
});
