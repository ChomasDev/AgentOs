import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  INTERFACE_KINDS,
  type InterfaceKind,
  type ManifestConfig,
  type ManifestInterface,
  type PackageManifest,
} from "./types.js";

const kinds = new Set<string>(INTERFACE_KINDS);

export async function loadPackageCatalog(
  repositoryRoot: string,
): Promise<PackageManifest[]> {
  const packagesRoot = join(repositoryRoot, "packages");
  const manifests: PackageManifest[] = [];

  for (const kindEntry of await readdir(packagesRoot, {
    withFileTypes: true,
  })) {
    if (!kindEntry.isDirectory()) {
      continue;
    }
    const kindRoot = join(packagesRoot, kindEntry.name);
    for (const packageEntry of await readdir(kindRoot, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (!packageEntry.isDirectory()) {
        continue;
      }
      const manifestPath = join(
        kindRoot,
        packageEntry.name,
        "agent-os.package.yaml",
      );
      try {
        manifests.push(
          parsePackageManifest(await readFile(manifestPath, "utf8")),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  return manifests.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function parsePackageManifest(source: string): PackageManifest {
  const value: unknown = parseYaml(source);
  if (!isRecord(value)) {
    throw new Error("Package manifest must be an object");
  }
  const id = requiredText(value.id, "id");
  const interfacesValue = value.interfaces;
  if (!Array.isArray(interfacesValue)) {
    throw new Error(`Package "${id}" must declare interfaces`);
  }

  return {
    schemaVersion: requiredNumber(value.schemaVersion, "schemaVersion"),
    id,
    name: requiredText(value.name, "name"),
    version: requiredText(value.version, "version"),
    description: optionalText(value.description),
    interfaces: interfacesValue.map((entry, index) =>
      parseInterface(entry, id, index),
    ),
  };
}

export function packagesForKind(
  catalog: readonly PackageManifest[],
  kind: InterfaceKind,
): PackageManifest[] {
  return catalog.filter((pkg) =>
    pkg.interfaces.some((iface) => iface.kind === kind),
  );
}

function parseInterface(
  value: unknown,
  packageId: string,
  index: number,
): ManifestInterface {
  if (!isRecord(value)) {
    throw new Error(
      `Package "${packageId}" interface ${index + 1} must be an object`,
    );
  }
  const kind = requiredText(value.kind, "interface.kind");
  if (!kinds.has(kind)) {
    throw new Error(`Package "${packageId}" has invalid kind "${kind}"`);
  }

  return {
    id: requiredText(value.id, "interface.id"),
    kind: kind as InterfaceKind,
    name: optionalText(value.name),
    className: optionalText(value.className),
    description: optionalText(value.description),
    permissions: stringList(value.permissions),
    required: stringList(value.required),
    config: configList(value.config),
  };
}

function configList(value: unknown): ManifestConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Interface config must be an array");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("Interface config entry must be an object");
    }
    return {
      key: requiredText(entry.key, "config.key"),
      env: optionalText(entry.env),
      type: optionalText(entry.type),
      required:
        typeof entry.required === "boolean" ? entry.required : undefined,
      default: entry.default,
      description: optionalText(entry.description),
    };
  });
}

function stringList(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Expected an array of strings");
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected non-empty string "${field}"`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`Expected number "${field}"`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
