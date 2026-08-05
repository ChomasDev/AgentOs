import { NativeCommandClient } from "./native-command.js";
import { scripts } from "./scripts.js";
import { requiredText } from "./validation.js";
import type { MacOSControlInput } from "./types.js";

export class AppControl {
  constructor(private readonly commands: NativeCommandClient) {}

  async open(
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const app = requiredText(input.app, "app");
    await this.commands.run("open", ["-a", app], signal);
    return { app, opened: true };
  }

  async setRunningState(
    input: MacOSControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const app = requiredText(input.app, "app");
    const operation = input.operation === "focus_app" ? "focus" : "quit";
    return this.commands.json(
      "osascript",
      ["-l", "JavaScript", scripts.apps, operation, app],
      signal,
    );
  }

  async list(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const apps = await this.commands.jsonValue(
      "osascript",
      ["-l", "JavaScript", scripts.apps, "list", ""],
      signal,
    );
    return { apps };
  }
}
