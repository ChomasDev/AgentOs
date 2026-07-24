import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export type AgentInterfaceKind =
  | "env"
  | "ai"
  | "discovery"
  | "orchestrator"
  | "agent"
  | "input"
  | "output"
  | "action";

export interface AgentInterfaces {
  env: string[];
  ai: string[];
  discovery: string[];
  orchestrator: string[];
  agent: string[];
  input: string[];
  output: string[];
  action: string[];
}

export interface AgentConf {
  schemaVersion: number;
  interfaces: AgentInterfaces;
}

const INTERFACE_KINDS = [
  "env",
  "ai",
  "discovery",
  "orchestrator",
  "agent",
  "input",
  "output",
  "action",
] as const satisfies readonly AgentInterfaceKind[];

export function parseAgentConfYaml(source: string): AgentConf {
  const raw: unknown = parseYaml(source);
  return assertAgentConf(raw);
}

export async function loadAgentConfYaml(path: string): Promise<AgentConf> {
  const source = await readFile(path, "utf8");
  return parseAgentConfYaml(source);
}

function assertAgentConf(value: unknown): AgentConf {
  if (!isRecord(value)) {
    throw new Error("Agent conf must be a YAML object");
  }

  if (
    typeof value.schemaVersion !== "number" ||
    !Number.isInteger(value.schemaVersion)
  ) {
    throw new Error('Agent conf "schemaVersion" must be an integer');
  }

  if (!isRecord(value.interfaces)) {
    throw new Error('Agent conf "interfaces" must be an object');
  }

  const interfaces = {} as AgentInterfaces;

  for (const kind of INTERFACE_KINDS) {
    const packages = value.interfaces[kind];

    if (!Array.isArray(packages) || !packages.every(isNonEmptyString)) {
      throw new Error(
        `Agent conf "interfaces.${kind}" must be an array of non-empty strings`,
      );
    }

    interfaces[kind] = packages;
  }

  return {
    schemaVersion: value.schemaVersion,
    interfaces,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
