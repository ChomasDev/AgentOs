import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  INTERFACE_KINDS,
  type AgentConfiguration,
  type InterfaceKind,
  type PackageEntry,
  type PackageManifest,
  type WizardSelection,
} from "./types.js";

export function createInitialSelection(
  catalog: readonly PackageManifest[],
  existing?: AgentConfiguration,
): WizardSelection {
  const interfaces = Object.fromEntries(
    INTERFACE_KINDS.map((kind) => [
      kind,
      existing?.interfaces[kind]?.map((entry) => entry.id) ?? [],
    ]),
  ) as Record<InterfaceKind, string[]>;
  const configs = new Map<string, Record<string, unknown>>();

  for (const kind of INTERFACE_KINDS) {
    for (const entry of existing?.interfaces[kind] ?? []) {
      if (entry.config) {
        configs.set(configKey(kind, entry.id), { ...entry.config });
      }
    }
  }

  ensureSingleDefault(interfaces, catalog, "ai");
  ensureSingleDefault(interfaces, catalog, "env");
  ensureSingleDefault(interfaces, catalog, "discovery");
  ensureSingleDefault(interfaces, catalog, "database", "database-sqlite");
  ensureSingleDefault(interfaces, catalog, "memory", "memory-database");
  ensureSingleDefault(interfaces, catalog, "orchestrator");
  ensureSingleDefault(interfaces, catalog, "agent");

  if (interfaces.input.length === 0 && hasPackage(catalog, "io-cli", "input")) {
    interfaces.input = ["io-cli"];
  }
  if (interfaces.output.length === 0 && hasPackage(catalog, "io-cli", "output")) {
    interfaces.output = ["io-cli"];
  }

  const aiId = interfaces.ai[0];
  const existingModel = aiId
    ? configs.get(configKey("ai", aiId))?.model
    : undefined;
  const manifestModel = catalog
    .find((pkg) => pkg.id === aiId)
    ?.interfaces.find((iface) => iface.kind === "ai")
    ?.config.find((entry) => entry.key === "model")?.default;

  return {
    interfaces,
    configs,
    model:
      typeof existingModel === "string"
        ? existingModel
        : typeof manifestModel === "string"
          ? manifestModel
          : "",
  };
}

export function normalizeRequirements(
  selection: WizardSelection,
  catalog: readonly PackageManifest[],
): WizardSelection {
  const interfaces = cloneInterfaces(selection.interfaces);
  let changed = true;

  while (changed) {
    changed = false;
    for (const pkg of catalog) {
      for (const iface of pkg.interfaces) {
        if (!interfaces[iface.kind].includes(pkg.id)) {
          continue;
        }
        for (const required of iface.required) {
          for (const requiredInterface of pkg.interfaces) {
            if (
              (requiredInterface.kind === required ||
                requiredInterface.id === required) &&
              !interfaces[requiredInterface.kind].includes(pkg.id)
            ) {
              interfaces[requiredInterface.kind].push(pkg.id);
              changed = true;
            }
          }
        }
      }
    }
  }

  return { ...selection, interfaces };
}

export function buildAgentConfiguration(
  selection: WizardSelection,
): AgentConfiguration {
  const interfaces = Object.fromEntries(
    INTERFACE_KINDS.map((kind) => [
      kind,
      selection.interfaces[kind].map((id): PackageEntry => {
        const stored = selection.configs.get(configKey(kind, id));
        const config =
          kind === "ai" && id === selection.interfaces.ai[0]
            ? { ...stored, ...(selection.model ? { model: selection.model } : {}) }
            : stored;
        return config && Object.keys(config).length > 0
          ? { id, config }
          : { id };
      }),
    ]),
  ) as AgentConfiguration["interfaces"];

  return { schemaVersion: 1, interfaces };
}

export function stringifyAgentConfiguration(
  configuration: AgentConfiguration,
): string {
  const yamlValue = {
    schemaVersion: configuration.schemaVersion,
    interfaces: Object.fromEntries(
      INTERFACE_KINDS.map((kind) => [
        kind,
        configuration.interfaces[kind].map((entry) =>
          entry.config ? entry : entry.id,
        ),
      ]),
    ),
  };
  return stringifyYaml(yamlValue, { lineWidth: 100 });
}

export async function loadAgentConfiguration(
  path: string,
): Promise<AgentConfiguration | undefined> {
  try {
    const value: unknown = parseYaml(await readFile(path, "utf8"));
    return assertAgentConfiguration(value);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function saveAgentConfiguration(
  path: string,
  configuration: AgentConfiguration,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(
    temporaryPath,
    stringifyAgentConfiguration(configuration),
    "utf8",
  );
  await rename(temporaryPath, path);
}

export function configKey(kind: InterfaceKind, id: string): string {
  return `${kind}:${id}`;
}

function assertAgentConfiguration(value: unknown): AgentConfiguration {
  if (!isRecord(value) || !isRecord(value.interfaces)) {
    throw new Error("Invalid agent configuration");
  }
  const rawInterfaces = value.interfaces;
  const interfaces = Object.fromEntries(
    INTERFACE_KINDS.map((kind) => {
      const entries = rawInterfaces[kind];
      if (!Array.isArray(entries)) {
        throw new Error(`Agent configuration interfaces.${kind} must be an array`);
      }
      return [kind, entries.map(parsePackageEntry)];
    }),
  ) as AgentConfiguration["interfaces"];
  return { schemaVersion: 1, interfaces };
}

function parsePackageEntry(value: unknown): PackageEntry {
  if (typeof value === "string") {
    return { id: value };
  }
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("Invalid package entry");
  }
  return {
    id: value.id,
    config: isRecord(value.config) ? value.config : undefined,
  };
}

function ensureSingleDefault(
  interfaces: Record<InterfaceKind, string[]>,
  catalog: readonly PackageManifest[],
  kind: InterfaceKind,
  preferredId?: string,
): void {
  if (interfaces[kind].length > 0) {
    interfaces[kind] = [interfaces[kind][0]!];
    return;
  }
  const first = catalog.find((pkg) =>
    pkg.id === preferredId && pkg.interfaces.some((iface) => iface.kind === kind),
  ) ?? catalog.find((pkg) =>
    pkg.interfaces.some((iface) => iface.kind === kind),
  );
  if (first) {
    interfaces[kind] = [first.id];
  }
}

function hasPackage(
  catalog: readonly PackageManifest[],
  id: string,
  kind: InterfaceKind,
): boolean {
  return catalog.some(
    (pkg) =>
      pkg.id === id && pkg.interfaces.some((iface) => iface.kind === kind),
  );
}

function cloneInterfaces(
  value: Record<InterfaceKind, string[]>,
): Record<InterfaceKind, string[]> {
  return Object.fromEntries(
    INTERFACE_KINDS.map((kind) => [kind, [...value[kind]]]),
  ) as Record<InterfaceKind, string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
