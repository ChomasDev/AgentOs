import type { AgentLoopEvent } from "@agent-os/core/domain";

export function formatAgentLoopEvent(event: AgentLoopEvent): string {
  switch (event.type) {
    case "discovery.started":
      return agentLine("DISCOVER", `Finding tools for: ${event.query}`);
    case "discovery.completed":
      return event.capabilities.length > 0
        ? agentLine("READY", `Using: ${event.capabilities.join(", ")}`)
        : agentLine("READY", "No matching tools; using the model directly");
    case "model.started":
      return event.capabilities.length > 0
        ? agentLine("MODEL", `Calling model with ${event.capabilities.length} ${
            event.capabilities.length === 1 ? "capability" : "capabilities"
          }`)
        : agentLine("MODEL", "Calling model without tools");
    case "capability.started":
      return toolBlock(
        event.capability,
        color.yellow("RUNNING"),
        "input",
        formatValue(event.arguments),
      );
    case "capability.completed": {
      const failed = isFailedResult(event.result);

      return toolBlock(
        event.capability,
        failed ? color.red("✗ FAILED") : color.green("✓ COMPLETED"),
        failed ? "error" : "output",
        formatToolResult(event.result),
      );
    }
    case "capability.failed":
      return toolBlock(
        event.capability,
        color.red("✗ FAILED"),
        "error",
        event.error,
      );
  }
}

const MAX_PREVIEW_LENGTH = 4_000;
const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined);

function ansi(open: number, close: number): (value: string) => string {
  return (value) =>
    useColor ? `\u001B[${open}m${value}\u001B[${close}m` : value;
}

const color = {
  bold: ansi(1, 22),
  dim: ansi(2, 22),
  cyan: ansi(36, 39),
  green: ansi(32, 39),
  yellow: ansi(33, 39),
  red: ansi(31, 39),
};

function agentLine(label: string, message: string): string {
  return `${color.dim("◆")} ${color.cyan(color.bold(label.padEnd(8)))} ${message}`;
}

function toolBlock(
  capability: string,
  status: string,
  label: string,
  content: string,
): string {
  const body = truncate(content);
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

function formatToolResult(value: unknown): string {
  if (!isRecord(value)) {
    return formatValue(value);
  }

  if (value.success === false && isRecord(value.error)) {
    const code =
      typeof value.error.code === "string" ? `${value.error.code}: ` : "";
    const message =
      typeof value.error.message === "string"
        ? value.error.message
        : formatValue(value.error);
    const details =
      value.error.details === undefined
        ? ""
        : `\n\n${color.dim("details")}\n${formatValue(value.error.details)}`;

    return `${code}${message}${details}`;
  }

  const data = isRecord(value.data) ? value.data : undefined;

  if (!data || !("stdout" in data || "stderr" in data)) {
    return formatValue(value);
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

function formatValue(value: unknown): string {
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

function truncate(value: string): string {
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
