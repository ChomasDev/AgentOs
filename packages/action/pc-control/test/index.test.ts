import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityExecutionContext } from "@agent-os/core/domain";
import {
  MacOSControlCapability,
  type NativeCommandRunner,
} from "../src/index.js";
import type {
  WebControl,
  WebPageSnapshot,
  WebSnapshotOptions,
  WebTarget,
} from "../src/chromium-controller.js";

const context: CapabilityExecutionContext = {
  runId: "run-1",
  callId: "call-1",
  startedAt: new Date(),
};

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

  assert.deepEqual(
    calls[0]?.args.slice(-5),
    ["move", "120", "240", "left", "1"],
  );
  assert.deepEqual(result, {
    success: true,
    data: { x: 120, y: 240 },
  });
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

test("web_fill atomically fills a DOM field and returns the updated page", async () => {
  const calls: Array<{
    target: WebTarget;
    value: string;
    options?: WebSnapshotOptions;
  }> = [];
  const page: WebPageSnapshot = {
    url: "https://example.test/login",
    title: "Login",
    readyState: "complete",
    text: "Email Password",
    html: '<input name="email" value="example@aaaa.it">',
    interactiveElements: [
      {
        selector: 'input[name="email"]',
        name: "email",
        value: "example@aaaa.it",
      },
    ],
    textTruncated: false,
    htmlTruncated: false,
  };
  const webController = createWebControl({
    fill: async (target, value, options) => {
      calls.push({ target, value, options });
      return {
        action: {
          operation: "fill",
          filled: true,
          verified: true,
          value,
        },
        page,
      };
    },
  });
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    webController,
  });

  const result = await capability.execute(
    {
      operation: "web_fill",
      label: "Email",
      value: "example@aaaa.it",
      waitMs: 250,
    },
    context,
  );

  assert.deepEqual(calls, [
    {
      target: {
        selector: undefined,
        targetText: undefined,
        label: "Email",
        name: undefined,
      },
      value: "example@aaaa.it",
      options: {
        waitMs: 250,
        maxHtmlChars: undefined,
        maxTextChars: undefined,
      },
    },
  ]);
  assert.deepEqual(result, {
    success: true,
    data: {
      action: {
        operation: "fill",
        filled: true,
        verified: true,
        value: "example@aaaa.it",
      },
      page,
    },
  });
});

test("web operations reject missing targets before opening a browser", async () => {
  let called = false;
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    webController: createWebControl({
      click: async () => {
        called = true;
        throw new Error("should not run");
      },
    }),
  });

  const result = await capability.execute(
    { operation: "web_click" },
    context,
  );

  assert.equal(called, false);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
    assert.match(result.error.message, /selector, targetText, label, or name/);
  }
});

test("web_select accepts an option selector and returns verified page state", async () => {
  const calls: Array<{
    target: WebTarget;
    choice: Record<string, unknown>;
  }> = [];
  const page: WebPageSnapshot = {
    url: "https://example.test/orders/invalid",
    title: "Invalid orders",
    readyState: "complete",
    text: "Edit shipping address",
    html: "<select><option>Edit shipping address</option></select>",
    interactiveElements: [],
    textTruncated: false,
    htmlTruncated: false,
  };
  const capability = new MacOSControlCapability({
    platform: "darwin",
    requestPermissionsOnInit: false,
    webController: createWebControl({
      select: async (target, choice) => {
        calls.push({ target, choice });
        return {
          action: {
            operation: "select",
            selected: true,
            verified: true,
            optionIndex: 1,
            optionText: "Edit shipping address",
          },
          page,
        };
      },
    }),
  });

  const result = await capability.execute(
    {
      operation: "web_select",
      selector:
        "tbody > tr:nth-of-type(6) select > option:nth-of-type(2)",
      waitMs: 3000,
    },
    context,
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    {
      target: {
        selector:
          "tbody > tr:nth-of-type(6) select > option:nth-of-type(2)",
        targetText: undefined,
        label: undefined,
        name: undefined,
      },
      choice: {
        optionText: undefined,
        optionValue: undefined,
        optionIndex: undefined,
      },
    },
  ]);
  if (result.success) {
    assert.equal(result.data.action.verified, true);
    assert.deepEqual(result.data.page, page);
  }
});

test("click_element uses accessibility actions without moving the mouse and returns fresh state", async () => {
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
  if (result.success) {
    assert.deepEqual(result.data.action, {
      operation: "perform",
      elementIndex: 3,
      role: "AXButton",
      performed: "AXPress",
    });
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
  }
});

function createWebControl(
  overrides: Partial<WebControl> = {},
): WebControl {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented");
  };
  return {
    navigate: notImplemented,
    snapshot: notImplemented,
    click: notImplemented,
    fill: notImplemented,
    select: notImplemented,
    press: notImplemented,
    waitFor: notImplemented,
    ...overrides,
  } as WebControl;
}
