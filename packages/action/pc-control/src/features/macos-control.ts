import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityResult,
} from "@agent-os/core/domain";
import { AccessibilityControl } from "./accessibility-control.js";
import { AppControl } from "./app-control.js";
import {
  commandErrorDetails,
  UnsupportedPlatformError,
  ValidationError,
} from "./errors.js";
import { macOSControlManifest } from "./manifest.js";
import { NativeCommandClient, executeNativeCommand } from "./native-command.js";
import { NativeInput } from "./native-input.js";
import { PermissionControl } from "./permissions.js";
import { ScreenCapture } from "./screen-capture.js";
import type {
  MacOSControlInput,
  MacOSControlOptions,
  MacOSPermissionStatus,
} from "./types.js";
import { clampInteger } from "./validation.js";

const INITIAL_PERMISSION_STATUS: MacOSPermissionStatus = {
  accessibility: null,
  automation: null,
  screenRecording: null,
  requested: false,
};

export class MacOSControlCapability
  implements Capability<MacOSControlInput, Record<string, unknown>>
{
  readonly manifest = macOSControlManifest;

  private readonly accessibility: AccessibilityControl;
  private readonly apps: AppControl;
  private readonly input: NativeInput;
  private readonly permissions: PermissionControl;
  private readonly platform: NodeJS.Platform;
  private readonly requestPermissionsOnInit: boolean;
  private readonly screenshots: ScreenCapture;
  private permissionStatus = INITIAL_PERMISSION_STATUS;

  constructor(options: MacOSControlOptions = {}) {
    const commands = new NativeCommandClient(
      options.runner ?? executeNativeCommand,
      options.timeoutMs ?? this.manifest.execution?.timeoutMs ?? 30_000,
    );
    const defaults = {
      depth: clampInteger(options.maxAccessibilityDepth ?? 5, 0, 20),
      maxElements: clampInteger(
        options.maxAccessibilityElements ?? 400,
        1,
        5_000,
      ),
    };

    this.platform = options.platform ?? process.platform;
    this.requestPermissionsOnInit = options.requestPermissionsOnInit ?? true;
    this.screenshots = new ScreenCapture(commands, options.cwd ?? process.cwd());
    this.accessibility = new AccessibilityControl(
      commands,
      this.screenshots,
      defaults,
    );
    this.apps = new AppControl(commands);
    this.input = new NativeInput(commands);
    this.permissions = new PermissionControl(commands);
  }

  async initialize(): Promise<void> {
    this.assertMacOS();
    if (!this.requestPermissionsOnInit) return;

    this.permissionStatus = await this.permissions.request();
    const denied = deniedPermissions(this.permissionStatus);
    if (denied.length === 0) return;

    console.warn(
      `[pc-control] Waiting for macOS permission: ${denied.join(", ")}. ` +
        "Enable the terminal/runtime in System Settings → Privacy & Security, then restart Agent OS.",
    );
  }

  async execute(
    input: MacOSControlInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<Record<string, unknown>>> {
    try {
      this.assertMacOS();
      return { success: true, data: await this.run(input, context.signal) };
    } catch (error) {
      return {
        success: false,
        error: {
          code: errorCode(error),
          message: error instanceof Error ? error.message : "macOS control failed",
          retryable: false,
          details: commandErrorDetails(error),
        },
      };
    }
  }

  private async run(input: MacOSControlInput, signal?: AbortSignal) {
    switch (input.operation) {
      case "permissions":
        this.permissionStatus = await this.permissions.request(signal);
        return { ...this.permissionStatus };
      case "open_app":
        return this.apps.open(input, signal);
      case "focus_app":
      case "quit_app":
        return this.apps.setRunningState(input, signal);
      case "list_apps":
        return this.apps.list(signal);
      case "get_accessibility_tree":
        return this.accessibility.tree(input, signal);
      case "get_app_state":
        return this.accessibility.state(input, signal);
      case "click_element":
      case "set_element_value":
      case "perform_element_action":
        return this.accessibility.act(input, signal);
      case "move_mouse":
        return this.input.move(input, signal);
      case "click":
        return this.input.click(input, signal);
      case "drag":
        return this.input.drag(input, signal);
      case "scroll":
        return this.input.scroll(input, signal);
      case "type_text":
        return this.input.typeText(input, signal);
      case "press_key":
        return this.input.pressKey(input, signal);
      case "screenshot":
        return this.screenshots.take(input.path, signal);
      default:
        throw new ValidationError(`Unknown operation: ${String(input.operation)}`);
    }
  }

  private assertMacOS(): void {
    if (this.platform === "darwin") return;
    throw new UnsupportedPlatformError(
      `macOS PC Control only supports macOS; current platform is ${this.platform}`,
    );
  }
}

function deniedPermissions(status: MacOSPermissionStatus): string[] {
  const permissions: Array<[boolean | null, string]> = [
    [status.accessibility, "Accessibility"],
    [status.automation, "Automation"],
    [status.screenRecording, "Screen Recording"],
  ];
  return permissions.flatMap(([granted, name]) => (granted === false ? [name] : []));
}

function errorCode(error: unknown): string {
  if (error instanceof ValidationError) return "VALIDATION_ERROR";
  if (error instanceof UnsupportedPlatformError) return "UNSUPPORTED_PLATFORM";
  return "MACOS_CONTROL_FAILED";
}
