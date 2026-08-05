import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityResult,
} from "@agent-os/core/domain";
import { executeCommand } from "./command.js";
import { ChromiumController } from "./chromium-controller.js";
import { UnsupportedPlatformError, ValidationError } from "./errors.js";
import { chromeControlManifest } from "./manifest.js";
import type {
  ChromeControlInput,
  ChromeControlOptions,
  WebControl,
} from "./types.js";
import {
  clampInteger,
  optionalTarget,
  requiredString,
  requiredTarget,
  requiredText,
  requiredUrl,
  selectChoice,
  snapshotOptions,
} from "./validation.js";

export class ChromeControlCapability
  implements Capability<ChromeControlInput, Record<string, unknown>>
{
  readonly manifest = chromeControlManifest;

  private readonly platform: NodeJS.Platform;
  private readonly web: WebControl;

  constructor(options: ChromeControlOptions = {}) {
    const timeoutMs =
      options.timeoutMs ?? this.manifest.execution?.timeoutMs ?? 30_000;
    const runner = options.runner ?? executeCommand;

    this.platform = options.platform ?? process.platform;
    this.web =
      options.webController ??
      new ChromiumController({
        browserApp: options.browserApp ?? "Google Chrome",
        cwd: options.cwd ?? process.cwd(),
        launch: (command, args, signal) =>
          runner(command, args, { signal, timeoutMs }),
        profileDirectory: options.browserProfileDirectory,
        startupTimeoutMs: options.webStartupTimeoutMs ?? 10_000,
      });
  }

  async initialize(): Promise<void> {
    this.assertMacOS();
  }

  async execute(
    input: ChromeControlInput,
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
          message:
            error instanceof Error ? error.message : "Chrome control failed",
          retryable: false,
        },
      };
    }
  }

  private run(input: ChromeControlInput, signal?: AbortSignal) {
    const options = snapshotOptions(input);
    switch (input.operation) {
      case "web_open":
        return this.web.navigate(requiredUrl(input.url), options, signal);
      case "web_snapshot":
        return this.web.snapshot(options, signal);
      case "web_click":
        return this.web.click(requiredTarget(input), options, signal);
      case "web_fill":
        return this.web.fill(
          requiredTarget(input),
          requiredString(input.value, "value"),
          options,
          signal,
        );
      case "web_select":
        return this.web.select(
          requiredTarget(input),
          selectChoice(input),
          options,
          signal,
        );
      case "web_press":
        return this.web.press(
          requiredText(input.key, "key"),
          optionalTarget(input),
          options,
          signal,
        );
      case "web_wait":
        return this.web.waitFor(
          requiredTarget(input),
          clampInteger(input.timeoutMs ?? 10_000, 100, 30_000),
          options,
          signal,
        );
      default:
        throw new ValidationError(`Unknown operation: ${String(input.operation)}`);
    }
  }

  private assertMacOS(): void {
    if (this.platform === "darwin") return;
    throw new UnsupportedPlatformError(
      `Chrome Control only supports macOS; current platform is ${this.platform}`,
    );
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ValidationError) return "VALIDATION_ERROR";
  if (error instanceof UnsupportedPlatformError) return "UNSUPPORTED_PLATFORM";
  return "BROWSER_CONTROL_FAILED";
}
