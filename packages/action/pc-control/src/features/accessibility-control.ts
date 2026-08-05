import { NativeCommandClient } from "./native-command.js";
import { ScreenCapture } from "./screen-capture.js";
import { scripts } from "./scripts.js";
import type {
  AccessibilityLimits,
  MacOSControlInput,
  MacOSControlOperation,
} from "./types.js";
import {
  abortableDelay,
  accessibilityLimits,
  clampInteger,
  nonNegativeInteger,
  requiredString,
  requiredText,
} from "./validation.js";

type ElementOperation = Extract<
  MacOSControlOperation,
  "click_element" | "set_element_value" | "perform_element_action"
>;

export class AccessibilityControl {
  constructor(
    private readonly commands: NativeCommandClient,
    private readonly screenshots: ScreenCapture,
    private readonly defaults: AccessibilityLimits,
  ) {}

  tree(input: MacOSControlInput, signal?: AbortSignal) {
    const app = requiredText(input.app, "app");
    return this.readTree(app, accessibilityLimits(input, this.defaults), signal);
  }

  state(input: MacOSControlInput, signal?: AbortSignal) {
    return this.readState(requiredText(input.app, "app"), input, signal);
  }

  async act(
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const app = requiredText(input.app, "app");
    const limits = accessibilityLimits(input, this.defaults);
    const args = elementActionArgs(input.operation as ElementOperation, input);
    const action = await this.commands.json(
      "osascript",
      [
        "-l",
        "JavaScript",
        scripts.accessibilityAction,
        app,
        String(nonNegativeInteger(input.elementIndex, "elementIndex")),
        ...args,
        String(limits.depth),
        String(limits.maxElements),
      ],
      signal,
    );

    await abortableDelay(clampInteger(input.waitMs ?? 300, 0, 10_000), signal);
    return { action, state: await this.readState(app, input, signal) };
  }

  private async readState(
    app: string,
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const accessibility = await this.readTree(
      app,
      accessibilityLimits(input, this.defaults),
      signal,
    );
    if (input.includeScreenshot === false) {
      return { app, accessibility, screenshot: null };
    }

    const screenshot = await this.screenshots.take(undefined, signal);
    return { app, accessibility, screenshot };
  }

  private readTree(
    app: string,
    limits: AccessibilityLimits,
    signal?: AbortSignal,
  ) {
    return this.commands.json(
      "osascript",
      [
        "-l",
        "JavaScript",
        scripts.accessibilityTree,
        app,
        String(limits.depth),
        String(limits.maxElements),
      ],
      signal,
    );
  }
}

function elementActionArgs(
  operation: ElementOperation,
  input: MacOSControlInput,
): [string, string] {
  if (operation === "set_element_value") {
    return ["set_value", requiredString(input.value, "value")];
  }
  if (operation === "perform_element_action") {
    return ["perform", requiredText(input.action, "action")];
  }
  return ["perform", "AXPress"];
}
