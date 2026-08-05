import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { NativeCommandClient } from "./native-command.js";

export class ScreenCapture {
  constructor(
    private readonly commands: NativeCommandClient,
    private readonly cwd: string,
  ) {}

  async take(
    suppliedPath?: string,
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
    await this.commands.run("screencapture", ["-x", path], signal);
    return { path };
  }
}
