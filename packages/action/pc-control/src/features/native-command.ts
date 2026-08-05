import { execFile } from "node:child_process";
import type { NativeCommandResult, NativeCommandRunner } from "./types.js";

export class NativeCommandClient {
  constructor(
    private readonly runner: NativeCommandRunner,
    private readonly timeoutMs: number,
  ) {}

  run(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<NativeCommandResult> {
    return this.runner(command, args, { signal, timeoutMs: this.timeoutMs });
  }

  async json(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const value = await this.jsonValue(command, args, signal);
    if (isRecord(value)) return value;
    throw new Error(`Expected ${command} to return a JSON object`);
  }

  async jsonValue(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const result = await this.run(command, args, signal);
    return JSON.parse(result.stdout.trim() || "null") as unknown;
  }

  async safe(
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

  async safeJson<T>(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<T | null> {
    const result = await this.safe(command, args, signal);
    if (!result) return null;

    try {
      return JSON.parse(result.stdout.trim()) as T;
    } catch {
      return null;
    }
  }
}

export const executeNativeCommand: NativeCommandRunner = (
  command,
  args,
  options,
) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        signal: options.signal,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
          return;
        }

        reject(
          Object.assign(error, {
            command,
            stderr: stderr.trim(),
            stdout: stdout.trim(),
          }),
        );
      },
    );
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
