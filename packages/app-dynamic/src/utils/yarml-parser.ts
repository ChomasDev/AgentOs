import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export type AgentInterfaceKind =
  | "env"
  | "ai"
  | "discovery"
  | "database"
  | "memory"
  | "orchestrator"
  | "agent"
  | "input"
  | "output"
  | "action";

export interface PackageConf {
  id: string;
  /** Constructor options merged on top of registry/env defaults. */
  config?: Record<string, unknown>;
}

export interface AgentInterfaces {
  env: PackageConf[];
  ai: PackageConf[];
  discovery: PackageConf[];
  database: PackageConf[];
  memory: PackageConf[];
  orchestrator: PackageConf[];
  agent: PackageConf[];
  input: PackageConf[];
  output: PackageConf[];
  action: PackageConf[];
}

export interface AgentConf {
  schemaVersion: number;
  interfaces: AgentInterfaces;
}

const INTERFACE_KINDS = [
  "env",
  "ai",
  "discovery",
  "database",
  "memory",
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

    if (!Array.isArray(packages)) {
      throw new Error(
        `Agent conf "interfaces.${kind}" must be an array of package ids or { id, config }`,
      );
    }

    interfaces[kind] = packages.map((entry, index) =>
      assertPackageConf(entry, kind, index),
    );
  }

  return {
    schemaVersion: value.schemaVersion,
    interfaces,
  };
}

function assertPackageConf(
  value: unknown,
  kind: AgentInterfaceKind,
  index: number,
): PackageConf {
  if (typeof value === "string" && value.trim() !== "") {
    return { id: value.trim() };
  }

  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error(
      `Agent conf "interfaces.${kind}[${index}]" must be a non-empty string or { id, config? }`,
    );
  }

  if (
    value.config !== undefined &&
    (!isRecord(value.config) || Array.isArray(value.config))
  ) {
    throw new Error(
      `Agent conf "interfaces.${kind}[${index}].config" must be an object`,
    );
  }

  return {
    id: value.id.trim(),
    config: value.config,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
