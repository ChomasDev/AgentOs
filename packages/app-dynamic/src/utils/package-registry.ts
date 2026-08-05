import type { CapabilityType } from "@agent-os/core/domain";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InitConf, LoadedPackage } from "./getinitConf.js";

export interface RegistryConfigEntry {
  key: string;
  env?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

export interface RegistryInterface {
  id: string;
  kind: CapabilityType | string;
  className: string;
  config?: readonly RegistryConfigEntry[];
}

interface RegistryPackage {
  id: string;
  interfaces: RegistryInterface[];
}

export interface RegistryIndex { packages: RegistryPackage[] }

export async function loadRegistryIndex(repositoryRoot: string): Promise<RegistryIndex> {
  const indexPath = join(repositoryRoot, ".agent-os/registry/index.json");
  const raw = JSON.parse(await readFile(indexPath, "utf8")) as RegistryIndex;
  if (!Array.isArray(raw.packages)) throw new Error(`Invalid registry index at ${indexPath}`);
  return raw;
}

export function interfacesFor(
  packageId: string,
  kind: CapabilityType,
  registry: RegistryIndex,
  installedInterfaces?: readonly string[],
): RegistryInterface[] {
  const pkg = registry.packages.find((entry) => entry.id === packageId);
  if (!pkg) {
    throw new Error(`Package "${packageId}" not found in registry index (.agent-os/registry/index.json)`);
  }
  return pkg.interfaces.filter(
    (iface) => iface.kind === kind && (!installedInterfaces || installedInterfaces.includes(iface.id)),
  );
}

export function overlayLoadedManifests(registry: RegistryIndex, init: InitConf): void {
  const loadedPackages = new Map<string, LoadedPackage>();
  for (const modules of Object.values(init.modules)) {
    for (const loaded of modules) loadedPackages.set(loaded.id, loaded);
  }

  for (const loaded of loadedPackages.values()) {
    const interfaces = loaded.manifest.interfaces.map((iface) => {
      if (typeof iface.className !== "string" || iface.className === "") {
        throw new Error(`Package "${loaded.id}" interface "${iface.id}" has no className`);
      }
      return {
        id: iface.id,
        kind: iface.kind,
        className: iface.className,
        config: Array.isArray(iface.config)
          ? iface.config as unknown as RegistryConfigEntry[]
          : undefined,
      };
    });
    const replacement = { id: loaded.id, interfaces };
    const index = registry.packages.findIndex((entry) => entry.id === loaded.id);
    if (index >= 0) registry.packages[index] = replacement;
    else registry.packages.push(replacement);
  }
}
