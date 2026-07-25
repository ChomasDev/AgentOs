import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgentInterfaceKind } from "./yarml-parser.js";

export const PACKAGE_MANIFEST_FILE = "agent-os.package.yaml";
export const INSTALL_SELECTION_FILE = "agent-os.install.yaml";

export interface PackageManifestInterface {
  id: string;
  kind: AgentInterfaceKind;
  name?: string;
  description?: string;
  permissions: string[];
  /** Kinds or interface ids which must be enabled with this interface. */
  required: string[];
  [key: string]: unknown;
}

export interface PackageManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  interfaces: PackageManifestInterface[];
}

export interface InstallSelection {
  schemaVersion: 1;
  package: string;
  interfaces: string[];
}

const KINDS = new Set<AgentInterfaceKind>([
  "env",
  "ai",
  "discovery",
  "orchestrator",
  "agent",
  "input",
  "output",
  "action",
]);

export async function loadPackageManifest(
  path: string,
): Promise<PackageManifest> {
  return parsePackageManifest(await readFile(path, "utf8"));
}

export function parsePackageManifest(source: string): PackageManifest {
  return assertPackageManifest(parseYaml(source));
}

export function assertPackageManifest(value: unknown): PackageManifest {
  if (!isRecord(value)) {
    throw new Error("Package manifest must be a YAML object");
  }
  const schemaVersion = integer(value.schemaVersion, "schemaVersion");
  const id = text(value.id, "id");
  const name = text(value.name, "name");
  const version = text(value.version, "version");
  if (!Array.isArray(value.interfaces) || value.interfaces.length === 0) {
    throw new Error('Package manifest "interfaces" must be a non-empty array');
  }

  const interfaces = value.interfaces.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Package manifest "interfaces[${index}]" must be an object`);
    }
    const kind = text(entry.kind, `interfaces[${index}].kind`);
    if (!KINDS.has(kind as AgentInterfaceKind)) {
      throw new Error(
        `Package manifest "interfaces[${index}].kind" is invalid: ${kind}`,
      );
    }

    return {
      ...entry,
      id: text(entry.id, `interfaces[${index}].id`),
      kind: kind as AgentInterfaceKind,
      name: optionalText(entry.name, `interfaces[${index}].name`),
      description: optionalText(
        entry.description,
        `interfaces[${index}].description`,
      ),
      permissions: stringList(
        entry.permissions,
        `interfaces[${index}].permissions`,
      ),
      required: stringList(
        entry.required,
        `interfaces[${index}].required`,
      ),
    };
  });

  const interfaceIds = new Set(interfaces.map((entry) => entry.id));
  for (const iface of interfaces) {
    for (const dependency of iface.required) {
      const matchesKind = KINDS.has(dependency as AgentInterfaceKind);
      if (!matchesKind && !interfaceIds.has(dependency)) {
        throw new Error(
          `Package manifest interface "${iface.id}" requires unknown interface or kind "${dependency}"`,
        );
      }
    }
  }

  return {
    schemaVersion,
    id,
    name,
    version,
    description: optionalText(value.description, "description"),
    interfaces,
  };
}

export function resolveRequiredInterfaces(
  manifest: PackageManifest,
  selectedIds: Iterable<string>,
): Set<string> {
  const selected = new Set(selectedIds);
  let changed = true;

  while (changed) {
    changed = false;
    for (const iface of manifest.interfaces) {
      if (!selected.has(iface.id)) {
        continue;
      }
      for (const requirement of iface.required) {
        for (const candidate of manifest.interfaces) {
          if (
            (candidate.id === requirement || candidate.kind === requirement) &&
            !selected.has(candidate.id)
          ) {
            selected.add(candidate.id);
            changed = true;
          }
        }
      }
    }
  }

  return selected;
}

export function stringifyInstallSelection(
  selection: InstallSelection,
): string {
  return stringifyYaml(selection, { lineWidth: 100 });
}

export function parseInstallSelection(source: string): InstallSelection {
  const value: unknown = parseYaml(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.package !== "string" ||
    !Array.isArray(value.interfaces) ||
    !value.interfaces.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Invalid Agent OS install selection");
  }
  return {
    schemaVersion: 1,
    package: value.package,
    interfaces: value.interfaces,
  };
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Package manifest "${path}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path);
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Package manifest "${path}" must be an integer`);
  }
  return value;
}

function stringList(value: unknown, path: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.trim() !== "")
  ) {
    throw new Error(`Package manifest "${path}" must be an array of strings`);
  }
  return value.map((entry) => entry.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
