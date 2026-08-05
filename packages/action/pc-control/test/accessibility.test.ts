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

test("click_element acts without moving the mouse and returns fresh state", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: NativeCommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (args.some((arg) => arg.endsWith("accessibility-action.js"))) {
      return {
        stdout: JSON.stringify({
          operation: "perform",
          elementIndex: 3,
          role: "AXButton",
          performed: "AXPress",
        }),
        stderr: "",
      };
    }
    return {
      stdout: JSON.stringify({
        app: "Example",
        windows: [
          {
            elementIndex: 0,
            role: "AXWindow",
            children: [
              {
                elementIndex: 3,
                role: "AXButton",
                title: "Continue",
                actions: ["AXPress"],
              },
            ],
          },
        ],
        elementCount: 4,
        truncated: false,
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
      operation: "click_element",
      app: "Example",
      elementIndex: 3,
      includeScreenshot: false,
      waitMs: 0,
    },
    context,
  );

  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.command === "osascript"), true);
  assert.equal(
    calls.some((call) => call.args.some((arg) => arg.endsWith("mouse.js"))),
    false,
  );
  if (!result.success) return;
  assert.equal(result.data.action.performed, "AXPress");
  assert.deepEqual(result.data.state, {
    app: "Example",
    accessibility: {
      app: "Example",
      windows: [
        {
          elementIndex: 0,
          role: "AXWindow",
          children: [
            {
              elementIndex: 3,
              role: "AXButton",
              title: "Continue",
              actions: ["AXPress"],
            },
          ],
        },
      ],
      elementCount: 4,
      truncated: false,
    },
    screenshot: null,
  });
});
