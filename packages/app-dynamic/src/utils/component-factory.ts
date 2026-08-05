import type {
  CapabilityType,
  DatabaseProvider,
  Environment,
} from "@agent-os/core/domain";
import { resolve } from "node:path";
import type { CapabilityModule, LoadedPackage } from "./getinitConf.js";
import {
  interfacesFor,
  type RegistryConfigEntry,
  type RegistryIndex,
} from "./package-registry.js";

type AnyConstructor = new (...args: any[]) => unknown;

export class SkipInstantiationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipInstantiationError";
  }
}

export function createEnvironment(
  packages: LoadedPackage[],
  registry: RegistryIndex,
  repositoryRoot: string,
): Environment {
  if (packages.length === 0) throw new Error("agent-conf must declare at least one env package");
  const loaded = packages[0]!;
  const ProcessEnvironment = getConstructor(loaded.module, "ProcessEnvironment");
  const DotenvEnvironment = getConstructor(loaded.module, "DotenvEnvironment");
  const CompositeEnvironment = getConstructor(loaded.module, "CompositeEnvironment");
  const defaults = ["env-node.process", "env-node.dotenv", "env-node.composite"];

  if (
    ProcessEnvironment && DotenvEnvironment && CompositeEnvironment &&
    defaults.every((id) => loaded.installedInterfaces.includes(id))
  ) {
    return new CompositeEnvironment([
      new ProcessEnvironment(),
      new DotenvEnvironment({ filePath: resolve(repositoryRoot, ".env") }),
    ]) as Environment;
  }

  const first = interfacesFor(loaded.id, "env", registry, loaded.installedInterfaces)[0];
  if (!first) throw new Error(`No env interfaces found for package "${loaded.id}"`);
  return instantiate(loaded.module, first.className, {}) as Environment;
}

export function createKindInstances<T>(
  packages: LoadedPackage[],
  kind: CapabilityType,
  registry: RegistryIndex,
  extras: Record<string, unknown>,
  env: Environment,
  database?: DatabaseProvider,
  sharedInstances?: Map<string, unknown>,
): T[] {
  const instances: T[] = [];
  for (const loaded of packages) {
    for (const iface of interfacesFor(loaded.id, kind, registry, loaded.installedInterfaces)) {
      const cacheKey = `${loaded.id}::${iface.className}`;
      const cached = sharedInstances?.get(cacheKey);
      if (cached) {
        instances.push(cached as T);
        continue;
      }
      try {
        const scopedExtras = database
          ? { ...extras, database: database.scope(loaded.id) }
          : extras;
        const options = buildOptions(iface.config, env, scopedExtras, loaded.config);
        const instance = instantiate(loaded.module, iface.className, options) as T;
        sharedInstances?.set(cacheKey, instance);
        instances.push(instance);
      } catch (error) {
        if (!(error instanceof SkipInstantiationError)) throw error;
        console.warn(`[dynamic] Skipping ${loaded.id}.${iface.className}: ${error.message}`);
      }
    }
  }
  return instances;
}

export function requireFirst<T>(instances: T[], kind: string): T {
  const first = instances[0];
  if (!first) throw new Error(`agent-conf must declare at least one ${kind} package`);
  return first;
}

export function buildOptions(
  config: readonly RegistryConfigEntry[] | undefined,
  env: Environment,
  extras: Record<string, unknown>,
  yamlConfig?: Record<string, unknown>,
): Record<string, unknown> {
  const options: Record<string, unknown> = { ...extras };
  for (const entry of config ?? []) {
    let value: unknown = yamlConfig?.[entry.key];
    if (value === undefined || value === "") value = entry.env ? env.get(entry.env) : undefined;
    if (value === undefined || value === "") value = entry.default;
    if ((value === undefined || value === "") && entry.required) {
      throw new SkipInstantiationError(`Missing required config "${entry.key}"${entry.env ? ` (${entry.env})` : ""}`);
    }
    if (value !== undefined && value !== "") options[entry.key] = coerceConfigValue(value, entry.type);
  }
  for (const [key, value] of Object.entries(yamlConfig ?? {})) {
    if (value !== undefined) options[key] = value;
  }
  if ("model" in options && !("models" in options)) options.models = [options.model];
  return options;
}

export function instantiate(
  module: CapabilityModule,
  className: string,
  options: Record<string, unknown>,
): unknown {
  const Constructor = getConstructor(module, className);
  if (!Constructor) throw new Error(`Module does not export class "${className}"`);
  try {
    return new Constructor(options);
  } catch (error) {
    if (Object.keys(options).length === 0) throw error;
    try { return new Constructor(); } catch { throw error; }
  }
}

function getConstructor(module: CapabilityModule, className: string): AnyConstructor | undefined {
  const value = module[className];
  return typeof value === "function" ? value as AnyConstructor : undefined;
}

function coerceConfigValue(value: unknown, type?: string): unknown {
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw new Error(`Invalid number config value: ${String(value)}`);
    return number;
  }
  if (type !== "boolean" || typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Invalid boolean config value: ${String(value)}`);
}
