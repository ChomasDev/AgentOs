import type {
  AgentLoopEvent,
  Environment,
} from "@agent-os/core/domain";

export function formatAgentLoopEvent(
  event: AgentLoopEvent,
  env: Environment,
): string {
  const color = createColors(
    !env.has("NO_COLOR") &&
      env.get("TERM") !== "dumb" &&
      (process.stdout.isTTY || env.has("FORCE_COLOR")),
  );

  switch (event.type) {
    case "discovery.started":
      return agentLine(color, "DISCOVER", `Finding tools for: ${event.query}`);
    case "discovery.completed":
      return event.capabilities.length > 0
        ? agentLine(color, "READY", `Using: ${event.capabilities.join(", ")}`)
        : agentLine(
            color,
            "READY",
            "No matching tools; using the model directly",
          );
    case "model.started":
      return event.capabilities.length > 0
        ? agentLine(
            color,
            "MODEL",
            `Calling model with ${event.capabilities.length} ${
              event.capabilities.length === 1 ? "capability" : "capabilities"
            }`,
          )
        : agentLine(color, "MODEL", "Calling model without tools");
    case "capability.started":
      return toolBlock(
        color,
        event.capability,
        color.yellow("RUNNING"),
        "input",
        formatValue(event.arguments, color),
      );
    case "capability.completed": {
      const failed = isFailedResult(event.result);

      return toolBlock(
        color,
        event.capability,
        failed ? color.red("✗ FAILED") : color.green("✓ COMPLETED"),
        failed ? "error" : "output",
        formatToolResult(event.result, color),
      );
    }
    case "capability.failed":
      return toolBlock(
        color,
        event.capability,
        color.red("✗ FAILED"),
        "error",
        event.error,
      );
  }
}

const MAX_PREVIEW_LENGTH = 4_000;

function ansi(
  useColor: boolean,
  open: number,
  close: number,
): (value: string) => string {
  return (value) =>
    useColor ? `\u001B[${open}m${value}\u001B[${close}m` : value;
}

function createColors(useColor: boolean) {
  return {
    bold: ansi(useColor, 1, 22),
    dim: ansi(useColor, 2, 22),
    cyan: ansi(useColor, 36, 39),
    green: ansi(useColor, 32, 39),
    yellow: ansi(useColor, 33, 39),
    red: ansi(useColor, 31, 39),
  };
}

type Colors = ReturnType<typeof createColors>;

function agentLine(color: Colors, label: string, message: string): string {
  return `${color.dim("◆")} ${color.cyan(color.bold(label.padEnd(8)))} ${message}`;
}

function toolBlock(
  color: Colors,
  capability: string,
  status: string,
  label: string,
  content: string,
): string {
  const body = truncate(content, color);
  const bodyLines = body.split("\n");
  const prefix = color.dim("│");
  const lines = [
    "",
    `${color.cyan("┌─")} ${color.cyan(color.bold("TOOL"))} ${color.bold(capability)}  ${status}`,
    `${prefix}  ${color.dim(label)}`,
    ...bodyLines.map((line) => `${prefix}    ${line}`),
    color.cyan("└─"),
  ];

  return lines.join("\n");
}

function formatToolResult(value: unknown, color: Colors): string {
  if (!isRecord(value)) {
    return formatValue(value, color);
  }

  if (value.success === false && isRecord(value.error)) {
    const code =
      typeof value.error.code === "string" ? `${value.error.code}: ` : "";
    const message =
      typeof value.error.message === "string"
        ? value.error.message
        : formatValue(value.error, color);
    const details =
      value.error.details === undefined
        ? ""
        : `\n\n${color.dim("details")}\n${formatValue(
            value.error.details,
            color,
          )}`;

    return `${code}${message}${details}`;
  }

  const data = isRecord(value.data) ? value.data : undefined;

  if (!data || !("stdout" in data || "stderr" in data)) {
    return formatValue(value, color);
  }

  const sections: string[] = [];
  const stdout = typeof data.stdout === "string" ? data.stdout : "";
  const stderr = typeof data.stderr === "string" ? data.stderr : "";

  if (stdout) {
    sections.push(stdout);
  }

  if (stderr) {
    sections.push(`${color.red("stderr:")}\n${stderr}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : color.dim("(no output)");
}

function formatValue(value: unknown, color: Colors): string {
  if (typeof value === "string") {
    return value || color.dim("(empty)");
  }

  if (value === undefined) {
    return color.dim("undefined");
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, color: Colors): string {
  if (value.length <= MAX_PREVIEW_LENGTH) {
    return value;
  }

  const omitted = value.length - MAX_PREVIEW_LENGTH;
  return `${value.slice(0, MAX_PREVIEW_LENGTH)}\n${color.dim(
    `… ${omitted.toLocaleString()} more characters`,
  )}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFailedResult(value: unknown): boolean {
  return isRecord(value) && value.success === false;
}
