import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
} from "@agent-os/core/domain";
import {
  ChromiumController,
  type WebControl,
  type WebSelectChoice,
  type WebSnapshotOptions,
  type WebTarget,
} from "./chromium-controller.js";

export type MacOSControlOperation =
  | "permissions"
  | "open_app"
  | "focus_app"
  | "quit_app"
  | "list_apps"
  | "get_accessibility_tree"
  | "get_app_state"
  | "click_element"
  | "set_element_value"
  | "perform_element_action"
  | "move_mouse"
  | "click"
  | "scroll"
  | "type_text"
  | "press_key"
  | "screenshot"
  | "web_open"
  | "web_snapshot"
  | "web_click"
  | "web_fill"
  | "web_select"
  | "web_press"
  | "web_wait";

export interface MacOSControlInput {
  operation: MacOSControlOperation;
  app?: string;
  text?: string;
  key?: string;
  modifiers?: readonly ("command" | "control" | "option" | "shift")[];
  x?: number;
  y?: number;
  button?: "left" | "right" | "center";
  clicks?: number;
  deltaX?: number;
  deltaY?: number;
  path?: string;
  depth?: number;
  maxElements?: number;
  url?: string;
  selector?: string;
  targetText?: string;
  label?: string;
  name?: string;
  value?: string;
  waitMs?: number;
  maxHtmlChars?: number;
  maxTextChars?: number;
  timeoutMs?: number;
  elementIndex?: number;
  action?: string;
  includeScreenshot?: boolean;
  optionText?: string;
  optionValue?: string;
  optionIndex?: number;
}

export interface NativeCommandResult {
  stdout: string;
  stderr: string;
}

export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
  },
) => Promise<NativeCommandResult>;

export interface MacOSPermissionStatus {
  accessibility: boolean | null;
  automation: boolean | null;
  screenRecording: boolean | null;
  requested: boolean;
  guidance?: string;
}

export interface MacOSControlOptions {
  cwd?: string;
  maxAccessibilityDepth?: number;
  maxAccessibilityElements?: number;
  platform?: NodeJS.Platform;
  requestPermissionsOnInit?: boolean;
  runner?: NativeCommandRunner;
  timeoutMs?: number;
  browserApp?: string;
  browserProfileDirectory?: string;
  webController?: WebControl;
  webStartupTimeoutMs?: number;
}

const manifest: CapabilityManifest = {
  id: "macos.pc-control",
  version: "0.4.0",
  name: "control_macos",
  description:
    "Controls the local Mac and a DOM-aware Chromium browser. Prefer click_element/set_element_value for native apps and web_* for websites. Use web_select for <select>/<option> controls; web_click automatically routes option selectors to selection. Both modes avoid the physical mouse and return fresh state.",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [
          "permissions",
          "open_app",
          "focus_app",
          "quit_app",
          "list_apps",
          "get_accessibility_tree",
          "get_app_state",
          "click_element",
          "set_element_value",
          "perform_element_action",
          "move_mouse",
          "click",
          "scroll",
          "type_text",
          "press_key",
          "screenshot",
          "web_open",
          "web_snapshot",
          "web_click",
          "web_fill",
          "web_select",
          "web_press",
          "web_wait",
        ],
      },
      app: { type: "string", description: "macOS application name." },
      text: { type: "string" },
      key: {
        type: "string",
        description:
          "A character or special key: return, tab, space, escape, delete, left, right, up, down, home, end, page_up, or page_down.",
      },
      modifiers: {
        type: "array",
        items: {
          type: "string",
          enum: ["command", "control", "option", "shift"],
        },
      },
      x: { type: "number" },
      y: { type: "number" },
      button: { type: "string", enum: ["left", "right", "center"] },
      clicks: { type: "integer", minimum: 1, maximum: 3 },
      deltaX: { type: "integer" },
      deltaY: { type: "integer" },
      path: { type: "string", description: "Output PNG path." },
      depth: { type: "integer", minimum: 0, maximum: 20 },
      maxElements: { type: "integer", minimum: 1, maximum: 5_000 },
      url: {
        type: "string",
        description: "URL for web_open.",
      },
      selector: {
        type: "string",
        description: "CSS selector for a web element.",
      },
      targetText: {
        type: "string",
        description: "Visible text used to locate a web element.",
      },
      label: {
        type: "string",
        description: "Visible label associated with a web form field.",
      },
      name: {
        type: "string",
        description: "HTML name attribute used to locate a web form field.",
      },
      value: {
        type: "string",
        description: "Value for web_fill. Password values are redacted in results.",
      },
      waitMs: {
        type: "integer",
        minimum: 0,
        maximum: 10_000,
        description: "Extra time to allow the page to update before returning its state.",
      },
      maxHtmlChars: { type: "integer", minimum: 1_000, maximum: 200_000 },
      maxTextChars: { type: "integer", minimum: 1_000, maximum: 100_000 },
      timeoutMs: {
        type: "integer",
        minimum: 100,
        maximum: 30_000,
        description: "Timeout for web_wait.",
      },
      elementIndex: {
        type: "integer",
        minimum: 0,
        description:
          "Fresh elementIndex from get_app_state or the state returned by the previous element action.",
      },
      action: {
        type: "string",
        description:
          "Accessibility action exposed by the element, such as AXPress or AXShowMenu.",
      },
      includeScreenshot: {
        type: "boolean",
        description:
          "Include a screenshot in get_app_state and post-action observations. Defaults to true.",
      },
      optionText: {
        type: "string",
        description: "Visible option text for web_select.",
      },
      optionValue: {
        type: "string",
        description: "HTML option value for web_select.",
      },
      optionIndex: {
        type: "integer",
        minimum: 0,
        description: "Zero-based option index for web_select.",
      },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    additionalProperties: true,
  },
  permissions: [
    "macos.accessibility",
    "macos.automation",
    "macos.screen-recording",
    "filesystem.write",
  ],
  tags: [
    "macos",
    "desktop",
    "accessibility",
    "mouse",
    "keyboard",
    "browser",
    "html",
    "dom",
    "virtual-input",
  ],
  execution: {
    timeoutMs: 30_000,
    idempotent: false,
  },
};

const scriptsDirectory = fileURLToPath(
  new URL("../scripts/", import.meta.url),
);
const scripts = {
  accessibilityTree: resolve(scriptsDirectory, "accessibility-tree.js"),
  accessibilityAction: resolve(
    scriptsDirectory,
    "accessibility-action.js",
  ),
  apps: resolve(scriptsDirectory, "apps.js"),
  automationPermission: resolve(
    scriptsDirectory,
    "automation-permission.applescript",
  ),
  mouse: resolve(scriptsDirectory, "mouse.js"),
  permissions: resolve(scriptsDirectory, "permissions.js"),
  pressKey: resolve(scriptsDirectory, "press-key.applescript"),
  scroll: resolve(scriptsDirectory, "scroll.js"),
  typeText: resolve(scriptsDirectory, "type-text.applescript"),
} as const;

export class MacOSControlCapability
  implements Capability<MacOSControlInput, Record<string, unknown>>
{
  readonly manifest = manifest;

  private readonly cwd: string;
  private readonly maxAccessibilityDepth: number;
  private readonly maxAccessibilityElements: number;
  private readonly platform: NodeJS.Platform;
  private readonly requestPermissionsOnInit: boolean;
  private readonly runner: NativeCommandRunner;
  private readonly timeoutMs: number;
  private readonly web: WebControl;
  private permissionStatus: MacOSPermissionStatus = {
    accessibility: null,
    automation: null,
    screenRecording: null,
    requested: false,
  };

  constructor(options: MacOSControlOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.maxAccessibilityDepth = clampInteger(
      options.maxAccessibilityDepth ?? 5,
      0,
      20,
    );
    this.maxAccessibilityElements = clampInteger(
      options.maxAccessibilityElements ?? 400,
      1,
      5_000,
    );
    this.platform = options.platform ?? process.platform;
    this.requestPermissionsOnInit = options.requestPermissionsOnInit ?? true;
    this.runner = options.runner ?? executeNativeCommand;
    this.timeoutMs =
      options.timeoutMs ?? manifest.execution?.timeoutMs ?? 30_000;
    this.web =
      options.webController ??
      new ChromiumController({
        browserApp: options.browserApp ?? "Google Chrome",
        cwd: this.cwd,
        launch: (command, args, signal) => this.run(command, args, signal),
        profileDirectory: options.browserProfileDirectory,
        startupTimeoutMs: options.webStartupTimeoutMs ?? 10_000,
      });
  }

  async initialize(): Promise<void> {
    this.assertMacOS();
    if (!this.requestPermissionsOnInit) {
      return;
    }
    this.permissionStatus = await this.requestPermissions();
    const denied = [
      this.permissionStatus.accessibility === false ? "Accessibility" : "",
      this.permissionStatus.automation === false ? "Automation" : "",
      this.permissionStatus.screenRecording === false ? "Screen Recording" : "",
    ].filter(Boolean);
    if (denied.length > 0) {
      console.warn(
        `[pc-control] Waiting for macOS permission: ${denied.join(", ")}. ` +
          "Enable the terminal/runtime in System Settings → Privacy & Security, then restart Agent OS.",
      );
    }
  }

  async execute(
    input: MacOSControlInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<Record<string, unknown>>> {
    try {
      this.assertMacOS();
      const data = await this.runOperation(input, context.signal);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error instanceof ValidationError
            ? "VALIDATION_ERROR"
            : error instanceof UnsupportedPlatformError
              ? "UNSUPPORTED_PLATFORM"
              : input.operation.startsWith("web_")
                ? "BROWSER_CONTROL_FAILED"
                : "MACOS_CONTROL_FAILED",
          message: error instanceof Error ? error.message : "macOS control failed",
          retryable: false,
          details: commandErrorDetails(error),
        },
      };
    }
  }

  private async runOperation(
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    switch (input.operation) {
      case "permissions":
        this.permissionStatus = await this.requestPermissions(signal);
        return { ...this.permissionStatus };
      case "open_app": {
        const app = requiredText(input.app, "app");
        await this.run("open", ["-a", app], signal);
        return { app, opened: true };
      }
      case "focus_app":
      case "quit_app": {
        const app = requiredText(input.app, "app");
        return this.runJson(
          "osascript",
          [
            "-l",
            "JavaScript",
            scripts.apps,
            input.operation === "focus_app" ? "focus" : "quit",
            app,
          ],
          signal,
        );
      }
      case "list_apps":
        return {
          apps: await this.runJsonValue(
            "osascript",
            ["-l", "JavaScript", scripts.apps, "list", ""],
            signal,
          ),
        };
      case "get_accessibility_tree": {
        const app = requiredText(input.app, "app");
        const depth = clampInteger(
          input.depth ?? this.maxAccessibilityDepth,
          0,
          20,
        );
        const maxElements = clampInteger(
          input.maxElements ?? this.maxAccessibilityElements,
          1,
          5_000,
        );
        return this.runJson(
          "osascript",
          [
            "-l",
            "JavaScript",
            scripts.accessibilityTree,
            app,
            String(depth),
            String(maxElements),
          ],
          signal,
        );
      }
      case "get_app_state": {
        const app = requiredText(input.app, "app");
        return this.getAppState(app, input, signal);
      }
      case "click_element":
      case "set_element_value":
      case "perform_element_action":
        return this.runElementOperation(input, signal);
      case "move_mouse": {
        const { x, y } = coordinates(input);
        return this.runJson(
          "osascript",
          [
            "-l",
            "JavaScript",
            scripts.mouse,
            "move",
            String(x),
            String(y),
            "left",
            "1",
          ],
          signal,
        );
      }
      case "click": {
        const { x, y } = coordinates(input);
        const button = input.button ?? "left";
        const clicks = clampInteger(input.clicks ?? 1, 1, 3);
        return this.runJson(
          "osascript",
          [
            "-l",
            "JavaScript",
            scripts.mouse,
            "click",
            String(x),
            String(y),
            button,
            String(clicks),
          ],
          signal,
        );
      }
      case "scroll": {
        const deltaX = finiteNumber(input.deltaX ?? 0, "deltaX");
        const deltaY = finiteNumber(input.deltaY ?? 0, "deltaY");
        return this.runJson(
          "osascript",
          [
            "-l",
            "JavaScript",
            scripts.scroll,
            String(deltaX),
            String(deltaY),
          ],
          signal,
        );
      }
      case "type_text": {
        const text = requiredString(input.text, "text");
        await this.run(
          "osascript",
          [scripts.typeText, text],
          signal,
        );
        return { typed: true, characterCount: text.length };
      }
      case "press_key":
        return this.pressKey(input, signal);
      case "screenshot":
        return this.takeScreenshot(input.path, signal);
      case "web_open":
        return this.web.navigate(
          requiredUrl(input.url),
          webSnapshotOptions(input),
          signal,
        );
      case "web_snapshot":
        return this.web.snapshot(webSnapshotOptions(input), signal);
      case "web_click":
        return this.web.click(
          webTarget(input),
          webSnapshotOptions(input),
          signal,
        );
      case "web_fill":
        return this.web.fill(
          webTarget(input),
          requiredString(input.value, "value"),
          webSnapshotOptions(input),
          signal,
        );
      case "web_select":
        return this.web.select(
          webTarget(input),
          webSelectChoice(input),
          webSnapshotOptions(input),
          signal,
        );
      case "web_press":
        return this.web.press(
          requiredText(input.key, "key"),
          optionalWebTarget(input),
          webSnapshotOptions(input),
          signal,
        );
      case "web_wait":
        return this.web.waitFor(
          webTarget(input),
          clampInteger(input.timeoutMs ?? 10_000, 100, 30_000),
          webSnapshotOptions(input),
          signal,
        );
      default:
        throw new ValidationError(
          `Unknown operation: ${String(input.operation)}`,
        );
    }
  }

  private async pressKey(
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const key = requiredText(input.key, "key").toLowerCase();
    const modifiers = input.modifiers ?? [];
    await this.run(
      "osascript",
      [scripts.pressKey, key, ...modifiers],
      signal,
    );
    return { key, modifiers: [...modifiers], pressed: true };
  }

  private async runElementOperation(
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const app = requiredText(input.app, "app");
    const elementIndex = nonNegativeInteger(
      input.elementIndex,
      "elementIndex",
    );
    const depth = clampInteger(
      input.depth ?? this.maxAccessibilityDepth,
      0,
      20,
    );
    const maxElements = clampInteger(
      input.maxElements ?? this.maxAccessibilityElements,
      1,
      5_000,
    );
    const operation =
      input.operation === "set_element_value" ? "set_value" : "perform";
    const argument =
      input.operation === "set_element_value"
        ? requiredString(input.value, "value")
        : input.operation === "perform_element_action"
          ? requiredText(input.action, "action")
          : "AXPress";
    const action = await this.runJson(
      "osascript",
      [
        "-l",
        "JavaScript",
        scripts.accessibilityAction,
        app,
        String(elementIndex),
        operation,
        argument,
        String(depth),
        String(maxElements),
      ],
      signal,
    );
    await abortableDelay(
      clampInteger(input.waitMs ?? 300, 0, 10_000),
      signal,
    );
    return {
      action,
      state: await this.getAppState(app, input, signal),
    };
  }

  private async getAppState(
    app: string,
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const depth = clampInteger(
      input.depth ?? this.maxAccessibilityDepth,
      0,
      20,
    );
    const maxElements = clampInteger(
      input.maxElements ?? this.maxAccessibilityElements,
      1,
      5_000,
    );
    const accessibility = await this.runJson(
      "osascript",
      [
        "-l",
        "JavaScript",
        scripts.accessibilityTree,
        app,
        String(depth),
        String(maxElements),
      ],
      signal,
    );
    const screenshot =
      input.includeScreenshot === false
        ? null
        : await this.takeScreenshot(undefined, signal);
    return { app, accessibility, screenshot };
  }

  private async takeScreenshot(
    suppliedPath: string | undefined,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const path = suppliedPath
      ? resolve(this.cwd, suppliedPath)
      : resolve(
        this.cwd,
        ".agent-os",
        "screenshots",
        `screenshot-${Date.now()}.png`,
      );
    await mkdir(dirname(path), { recursive: true });
    await this.run("screencapture", ["-x", path], signal);
    return { path };
  }

  private async requestPermissions(
    signal?: AbortSignal,
  ): Promise<MacOSPermissionStatus> {
    const native = await this.safeRunJson<{
      accessibility?: boolean;
    }>(
      "osascript",
      ["-l", "JavaScript", scripts.permissions],
      signal,
    );
    const automation = await this.safeRun(
      "osascript",
      [scripts.automationPermission],
      signal,
    );
    const screenRecording = await this.probeScreenRecording(signal);
    const status: MacOSPermissionStatus = {
      accessibility:
        typeof native?.accessibility === "boolean"
          ? native.accessibility
          : null,
      automation: automation === null ? false : true,
      screenRecording,
      requested: true,
    };
    if (
      status.accessibility !== true ||
      status.automation !== true ||
      status.screenRecording !== true
    ) {
      status.guidance =
        "Enable your terminal (and osascript if listed) in System Settings → Privacy & Security → Accessibility, Automation, and Screen Recording, then restart Agent OS.";
    }
    return status;
  }

  private async probeScreenRecording(
    signal?: AbortSignal,
  ): Promise<boolean | null> {
    let temporaryDirectory: string | undefined;
    try {
      temporaryDirectory = await mkdtemp(
        resolve(tmpdir(), "agent-os-screen-recording-"),
      );
      const result = await this.safeRun(
        "screencapture",
        [
          "-x",
          "-R0,0,1,1",
          resolve(temporaryDirectory, "permission-check.png"),
        ],
        signal,
      );
      return result !== null;
    } catch {
      return null;
    } finally {
      if (temporaryDirectory) {
        try {
          await rm(temporaryDirectory, { recursive: true, force: true });
        } catch {
          // The permission result should not be obscured by temp cleanup.
        }
      }
    }
  }

  private run(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<NativeCommandResult> {
    return this.runner(command, args, {
      signal,
      timeoutMs: this.timeoutMs,
    });
  }

  private async runJson(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const result = await this.run(command, args, signal);
    const value: unknown = JSON.parse(result.stdout.trim() || "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Expected ${command} to return a JSON object`);
    }
    return value as Record<string, unknown>;
  }

  private async runJsonValue(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const result = await this.run(command, args, signal);
    return JSON.parse(result.stdout.trim() || "null") as unknown;
  }

  private async safeRun(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<NativeCommandResult | null> {
    try {
      return await this.run(command, args, signal);
    } catch {
      return null;
    }
  }

  private async safeRunJson<T>(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<T | null> {
    const result = await this.safeRun(command, args, signal);
    if (!result) {
      return null;
    }
    try {
      return JSON.parse(result.stdout.trim()) as T;
    } catch {
      return null;
    }
  }

  private assertMacOS(): void {
    if (this.platform !== "darwin") {
      throw new UnsupportedPlatformError(
        `macOS PC Control only supports macOS; current platform is ${this.platform}`,
      );
    }
  }
}

function executeNativeCommand(
  command: string,
  args: readonly string[],
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<NativeCommandResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        signal: options.signal,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              command,
              stderr: stderr.trim(),
              stdout: stdout.trim(),
            }),
          );
          return;
        }
        resolvePromise({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      },
    );
  });
}

function coordinates(input: MacOSControlInput): { x: number; y: number } {
  return {
    x: finiteNumber(input.x, "x"),
    y: finiteNumber(input.y, "y"),
  };
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`Input '${name}' must be a finite number`);
  }
  return value;
}

function clampInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`Expected an integer between ${min} and ${max}`);
  }
  return Math.min(max, Math.max(min, value));
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`Input '${name}' must be a non-negative integer`);
  }
  return value;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`Input '${name}' is required`);
  }
  return value.trim();
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`Input '${name}' is required`);
  }
  return value;
}

function requiredUrl(value: unknown): string {
  const url = requiredText(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("Input 'url' must be an absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ValidationError("Input 'url' must use http or https");
  }
  return parsed.href;
}

function webTarget(input: MacOSControlInput): WebTarget {
  const target = optionalWebTarget(input);
  if (!target) {
    throw new ValidationError(
      "Provide selector, targetText, label, or name for this web operation",
    );
  }
  return target;
}

function optionalWebTarget(
  input: MacOSControlInput,
): WebTarget | undefined {
  const target: WebTarget = {
    selector: optionalText(input.selector),
    targetText: optionalText(input.targetText),
    label: optionalText(input.label),
    name: optionalText(input.name),
  };
  return target.selector ||
    target.targetText ||
    target.label ||
    target.name
    ? target
    : undefined;
}

function webSelectChoice(input: MacOSControlInput): WebSelectChoice {
  const choice: WebSelectChoice = {
    optionText: optionalText(input.optionText),
    optionValue:
      typeof input.optionValue === "string"
        ? input.optionValue
        : undefined,
    optionIndex:
      input.optionIndex === undefined
        ? undefined
        : nonNegativeInteger(input.optionIndex, "optionIndex"),
  };
  const count = [
    choice.optionText !== undefined,
    choice.optionValue !== undefined,
    choice.optionIndex !== undefined,
  ].filter(Boolean).length;
  const selectorTargetsOption = optionalText(input.selector)
    ?.toLowerCase()
    .includes("option");
  if (count === 0 && !selectorTargetsOption) {
    throw new ValidationError(
      "Provide optionText, optionValue, or optionIndex for web_select",
    );
  }
  if (count > 1) {
    throw new ValidationError(
      "Provide only one of optionText, optionValue, or optionIndex",
    );
  }
  return choice;
}

function webSnapshotOptions(
  input: MacOSControlInput,
): WebSnapshotOptions {
  return {
    waitMs:
      input.waitMs === undefined
        ? undefined
        : clampInteger(input.waitMs, 0, 10_000),
    maxHtmlChars:
      input.maxHtmlChars === undefined
        ? undefined
        : clampInteger(input.maxHtmlChars, 1_000, 200_000),
    maxTextChars:
      input.maxTextChars === undefined
        ? undefined
        : clampInteger(input.maxTextChars, 1_000, 100_000),
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation aborted"));
      },
      { once: true },
    );
  });
}

function commandErrorDetails(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const details = error as Error & {
    command?: string;
    stderr?: string;
    stdout?: string;
  };
  if (!details.command && !details.stderr && !details.stdout) {
    return undefined;
  }
  return {
    command: details.command,
    stderr: details.stderr,
    stdout: details.stdout,
  };
}

class ValidationError extends Error {}
class UnsupportedPlatformError extends Error {}
