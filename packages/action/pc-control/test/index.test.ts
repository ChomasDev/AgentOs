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

test("exposes only native macOS operations", () => {
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
  });
  const properties = capability.manifest.inputSchema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const operations = properties.operation?.enum as string[];

  assert.equal(
    operations.some((operation) => operation.startsWith("web_")),
    false,
  );
});

test("requests macOS privacy permissions during initialization", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: NativeCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return args.includes("-l")
      ? {
          stdout: JSON.stringify({
            accessibility: true,
            screenRecording: true,
          }),
          stderr: "",
        }
      : { stdout: "12", stderr: "" };
  };
  const capability = new MacOSControlCapability({
    platform: "darwin",
    runner,
  });

  await capability.initialize();
  const result = await capability.execute(
    { operation: "permissions" },
    context,
  );

  assert.equal(calls.length, 6);
  assert.deepEqual(
    calls.map((call) => call.command),
    [
      "osascript",
      "osascript",
      "screencapture",
      "osascript",
      "osascript",
      "screencapture",
    ],
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.accessibility, true);
    assert.equal(result.data.automation, true);
    assert.equal(result.data.screenRecording, true);
  }
});

test("reports screen recording as denied when the capture probe fails", async () => {
  const runner: NativeCommandRunner = async (command, args) => {
    if (command === "screencapture") {
      throw new Error("screen capture denied");
    }
    return args.includes("-l")
      ? { stdout: '{"accessibility":true}', stderr: "" }
      : { stdout: "", stderr: "" };
  };
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    runner,
  });

  const result = await capability.execute(
    { operation: "permissions" },
    context,
  );

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.accessibility, true);
    assert.equal(result.data.automation, true);
    assert.equal(result.data.screenRecording, false);
    assert.match(String(result.data.guidance), /Screen Recording/);
  }
});

test("passes application names as native arguments without a shell", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: NativeCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return { stdout: "", stderr: "" };
  };
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    runner,
  });

  const app = 'TextEdit"; do shell script "touch /tmp/nope';
  const result = await capability.execute(
    { operation: "open_app", app },
    context,
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    {
      command: "open",
      args: ["-a", app],
    },
  ]);
});

test("returns running applications from a JSON array", async () => {
  const runner: NativeCommandRunner = async () => ({
    stdout: '[{"name":"Finder","frontmost":true,"visible":true}]',
    stderr: "",
  });
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    runner,
  });

  const result = await capability.execute({ operation: "list_apps" }, context);

  assert.deepEqual(result, {
    success: true,
    data: {
      apps: [{ name: "Finder", frontmost: true, visible: true }],
    },
  });
});

test("rejects non-macOS platforms without invoking native commands", async () => {
  let called = false;
  const capability = new MacOSControlCapability({
    platform: "linux",
    runner: async () => {
      called = true;
      return { stdout: "", stderr: "" };
    },
  });

  await assert.rejects(
    capability.initialize(),
    /only supports macOS; current platform is linux/,
  );
  const result = await capability.execute(
    { operation: "open_app", app: "Finder" },
    context,
  );

  assert.equal(called, false);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, "UNSUPPORTED_PLATFORM");
  }
});
