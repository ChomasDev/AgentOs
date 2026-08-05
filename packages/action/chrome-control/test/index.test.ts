import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityExecutionContext } from "@agent-os/core/domain";
import {
  ChromeControlCapability,
  type WebControl,
  type WebPageSnapshot,
  type WebSnapshotOptions,
  type WebTarget,
} from "../src/index.js";

const context: CapabilityExecutionContext = {
  runId: "run-1",
  callId: "call-1",
  startedAt: new Date(),
};

test("exposes browser operations through a separate Chrome capability", () => {
  const capability = new ChromeControlCapability({
    platform: "darwin",
    webController: createWebControl(),
  });

  assert.equal(capability.manifest.id, "chrome.control");
  assert.equal(capability.manifest.name, "control_chrome");
  assert.deepEqual(
    capability.manifest.inputSchema.properties?.operation?.enum,
    [
      "web_open",
      "web_snapshot",
      "web_click",
      "web_fill",
      "web_select",
      "web_press",
      "web_wait",
    ],
  );
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
    interactiveElements: [],
    textTruncated: false,
    htmlTruncated: false,
  };
  const capability = new ChromeControlCapability({
    platform: "darwin",
    webController: createWebControl({
      fill: async (target, value, options) => {
        calls.push({ target, value, options });
        return {
          action: { operation: "fill", filled: true, verified: true, value },
          page,
        };
      },
    }),
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

  assert.equal(result.success, true);
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
});

test("rejects missing element targets before invoking Chrome", async () => {
  let called = false;
  const capability = new ChromeControlCapability({
    platform: "darwin",
    webController: createWebControl({
      click: async () => {
        called = true;
        throw new Error("should not run");
      },
    }),
  });

  const result = await capability.execute({ operation: "web_click" }, context);

  assert.equal(called, false);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
    assert.match(result.error.message, /selector, targetText, label, or name/);
  }
});

test("web_select accepts an option selector", async () => {
  const calls: Array<{ target: WebTarget; choice: Record<string, unknown> }> = [];
  const page: WebPageSnapshot = {
    url: "https://example.test/orders",
    title: "Orders",
    readyState: "complete",
    text: "Edit shipping address",
    html: "<select><option>Edit shipping address</option></select>",
    interactiveElements: [],
    textTruncated: false,
    htmlTruncated: false,
  };
  const capability = new ChromeControlCapability({
    platform: "darwin",
    webController: createWebControl({
      select: async (target, choice) => {
        calls.push({ target, choice });
        return {
          action: { operation: "select", selected: true, verified: true },
          page,
        };
      },
    }),
  });

  const selector = "table select > option:nth-of-type(2)";
  const result = await capability.execute(
    { operation: "web_select", selector },
    context,
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    {
      target: {
        selector,
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
});

function createWebControl(overrides: Partial<WebControl> = {}): WebControl {
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
