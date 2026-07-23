import { execFile } from "node:child_process";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
} from "@agent-os/core/domain";

export interface RunCLICommandInput {
  command: string;
  args: readonly string[];
}

export interface RunCLICommandOutput {
  stdout: string;
  stderr: string;
}

export interface RunCLICommandCapabilityOptions {
  allowedCommands?: readonly string[];
  cwd?: string;
  timeoutMs?: number;
}

const manifest: CapabilityManifest = {
  id: "cli.run-command",
  version: "1.0.0",
  name: "run_cli_command",
  description:
    "Inspects the local runtime by running an allowed CLI command without invoking a shell. Use it to get the current folder or list files.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Executable name: echo, pwd, ls, whoami, or date.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments passed directly to the executable.",
      },
    },
    required: ["command", "args"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
    required: ["stdout", "stderr"],
    additionalProperties: false,
  },
  permissions: ["cli.execute"],
  tags: ["cli", "command", "local"],
  execution: {
    timeoutMs: 5_000,
    idempotent: false,
  },
  examples: [
    {
      request: "Print hello in the CLI",
      arguments: {
        command: "echo",
        args: ["hello"],
      },
    },
    {
      request: "What is the current folder or repository?",
      arguments: {
        command: "pwd",
        args: [],
      },
    },
    {
      request: "List the files in the current directory",
      arguments: {
        command: "ls",
        args: ["-la"],
      },
    },
  ],
};

const defaultAllowedCommands = ["echo", "pwd", "ls", "whoami", "date"];

export class RunCLICommandCapability
  implements Capability<RunCLICommandInput, RunCLICommandOutput>
{
  readonly manifest = manifest;

  private readonly allowedCommands: ReadonlySet<string>;
  private readonly cwd?: string;
  private readonly timeoutMs: number;

  constructor(options: RunCLICommandCapabilityOptions = {}) {
    this.allowedCommands = new Set(
      options.allowedCommands ?? defaultAllowedCommands,
    );
    this.cwd = options.cwd;
    this.timeoutMs =
      options.timeoutMs ?? manifest.execution?.timeoutMs ?? 5_000;
  }

  async execute(
    input: RunCLICommandInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<RunCLICommandOutput>> {
    const command = input.command?.trim();

    if (!command) {
      return failure("VALIDATION_ERROR", "Input 'command' is required");
    }

    if (!this.allowedCommands.has(command)) {
      return failure(
        "COMMAND_NOT_ALLOWED",
        `Command "${command}" is not allowed`,
      );
    }

    try {
      const result = await executeFile({
        command,
        args: input.args,
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
        signal: context.signal,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const details = normalizeExecutionError(error);

      return {
        success: false,
        error: {
          code: "COMMAND_FAILED",
          message: details.stderr || details.message,
          retryable: false,
          details,
        },
      };
    }
  }
}

interface ExecuteFileOptions {
  command: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

function executeFile(
  options: ExecuteFileOptions,
): Promise<RunCLICommandOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      options.command,
      [...options.args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        signal: options.signal,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            }),
          );
          return;
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      },
    );
  });
}

function failure(
  code: string,
  message: string,
): CapabilityResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

function normalizeExecutionError(error: unknown): {
  message: string;
  stdout: string;
  stderr: string;
} {
  if (!(error instanceof Error)) {
    return {
      message: "CLI command failed",
      stdout: "",
      stderr: "",
    };
  }

  const details = error as Error & {
    stdout?: string;
    stderr?: string;
  };

  return {
    message: error.message,
    stdout: details.stdout ?? "",
    stderr: details.stderr ?? "",
  };
}
