import type {
  AgentLoop,
  AIProvider,
  Capability,
  CapabilityDiscovery,
  CapabilityType,
  Environment,
  InputInterface,
  Orchestrator,
  OutputInterface,
} from "@agent-os/core/domain";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OS from "../Os/index.js";
import type {
  CapabilityModule,
  InitConf,
  LoadedPackage,
} from "./getinitConf.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

type AnyConstructor = new (...args: any[]) => unknown;

interface RegistryInterface {
  id: string;
  kind: CapabilityType | string;
  className: string;
  config?: readonly RegistryConfigEntry[];
}

interface RegistryConfigEntry {
  key: string;
  env?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

interface RegistryPackage {
  id: string;
  interfaces: RegistryInterface[];
}

interface RegistryIndex {
  packages: RegistryPackage[];
}

class SkipInstantiationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipInstantiationError";
  }
}

export async function bootFromInit(init: InitConf): Promise<void> {
  const registry = await loadRegistryIndex();
  overlayLoadedManifests(registry, init);
  const env = createEnvironment(init.modules.env, registry);

  const model = requireFirst(
    createKindInstances<AIProvider>(
      init.modules.ai,
      "ai",
      registry,
      { workingDirectory: repositoryRoot },
      env,
    ),
    "ai",
  );

  const capabilityDiscovery = requireFirst(
    createKindInstances<CapabilityDiscovery>(
      init.modules.discovery,
      "discovery",
      registry,
      {},
      env,
    ),
    "discovery",
  );

  for (const action of createKindInstances<Capability>(
    init.modules.action,
    "action",
    registry,
    { env, cwd: repositoryRoot },
    env,
  )) {
    await initializeCapability(action);
    await capabilityDiscovery.register(action);
  }

  // Actions that live on input packages (e.g. cronjob manage) when not listed under action.
  for (const loaded of init.modules.input) {
    for (const iface of interfacesFor(
      loaded.id,
      "action",
      registry,
      loaded.installedInterfaces,
    )) {
      const alreadyListed = init.modules.action.some(
        (entry) => entry.id === loaded.id,
      );
      if (alreadyListed) {
        continue;
      }
      try {
        const action = instantiate(
          loaded.module,
          iface.className,
          buildOptions(iface.config, env, { env, cwd: repositoryRoot }),
        ) as Capability;
        await initializeCapability(action);
        await capabilityDiscovery.register(action);
      } catch (error) {
        if (error instanceof SkipInstantiationError) {
          continue;
        }
        throw error;
      }
    }
  }

  const agentLoop = requireFirst(
    createKindInstances<AgentLoop>(
      init.modules.agent,
      "agent",
      registry,
      { model, capabilityDiscovery },
      env,
    ),
    "agent",
  );

  const orchestrator = requireFirst(
    createKindInstances<Orchestrator>(
      init.modules.orchestrator,
      "orchestrator",
      registry,
      { model, capabilityDiscovery },
      env,
    ),
    "orchestrator",
  );

  const shutdownRef: { current?: () => void } = {};
  // Share instances across kinds so dual input/output adapters (openrouter)
  // keep HTTP request context for write().
  const sharedInstances = new Map<string, unknown>();
  const inputs = createKindInstances<InputInterface>(
    init.modules.input,
    "input",
    registry,
    {
      env,
      onInterrupt: () => shutdownRef.current?.(),
      databasePath: env.getOrDefault(
        "CRONJOB_DB_PATH",
        resolve(repositoryRoot, ".agent-os/cronjobs.sqlite"),
      ),
      workingDirectory: repositoryRoot,
    },
    env,
    sharedInstances,
  );
  const outputs = createKindInstances<OutputInterface>(
    init.modules.output,
    "output",
    registry,
    { env },
    env,
    sharedInstances,
  );

  const closers: Array<() => Promise<void>> = [];
  for (const input of inputs) {
    const maybeClose = (input as { close?: () => Promise<void> }).close;
    if (typeof maybeClose === "function") {
      closers.push(() => maybeClose.call(input));
    }
  }

  if (inputs.length === 0) {
    throw new Error("No input interfaces could be created from agent-conf");
  }
  if (outputs.length === 0) {
    throw new Error("No output interfaces could be created from agent-conf");
  }

  const os = new OS();
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void os.stopListener().catch((error: unknown) => {
      console.error("Failed to stop Agent OS:", error);
      process.exitCode = 1;
    });
  };
  shutdownRef.current = shutdown;

  os.boot({
    agentLoop,
    env,
    input: inputs,
    orchestrator,
    output: outputs,
    settings: {
      agentic: true,
      stream: env.getOrDefault("AI_STREAM", "true") !== "false",
      showSteps: env.getOrDefault("AI_SHOW_STEPS", "true") !== "false",
    },
  });

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await os.startListener();
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await Promise.allSettled(closers.map((close) => close()));
  }
}

async function initializeCapability(action: Capability): Promise<void> {
  if (typeof action.initialize === "function") {
    await action.initialize();
  }
}

function createEnvironment(
  packages: LoadedPackage[],
  registry: RegistryIndex,
): Environment {
  if (packages.length === 0) {
    throw new Error("agent-conf must declare at least one env package");
  }

  const loaded = packages[0]!;
  const module = loaded.module;
  const ProcessEnvironment = getConstructor(module, "ProcessEnvironment");
  const DotenvEnvironment = getConstructor(module, "DotenvEnvironment");
  const CompositeEnvironment = getConstructor(module, "CompositeEnvironment");
  const defaultEnvironmentInterfaces = [
    "env-node.process",
    "env-node.dotenv",
    "env-node.composite",
  ];

  if (
    ProcessEnvironment &&
    DotenvEnvironment &&
    CompositeEnvironment &&
    defaultEnvironmentInterfaces.every((id) =>
      loaded.installedInterfaces.includes(id),
    )
  ) {
    return new CompositeEnvironment([
      new ProcessEnvironment(),
      new DotenvEnvironment({
        filePath: resolve(repositoryRoot, ".env"),
      }),
    ]) as Environment;
  }

  const first = interfacesFor(
    loaded.id,
    "env",
    registry,
    loaded.installedInterfaces,
  )[0];
  if (!first) {
    throw new Error(`No env interfaces found for package "${loaded.id}"`);
  }
  return instantiate(module, first.className, {}) as Environment;
}

function createKindInstances<T>(
  packages: LoadedPackage[],
  kind: CapabilityType,
  registry: RegistryIndex,
  extras: Record<string, unknown>,
  env: Environment,
  sharedInstances?: Map<string, unknown>,
): T[] {
  const instances: T[] = [];

  for (const loaded of packages) {
    for (const iface of interfacesFor(
      loaded.id,
      kind,
      registry,
      loaded.installedInterfaces,
    )) {
      const cacheKey = `${loaded.id}::${iface.className}`;
      const cached = sharedInstances?.get(cacheKey);
      if (cached) {
        instances.push(cached as T);
        continue;
      }

      try {
        const options = buildOptions(
          iface.config,
          env,
          extras,
          loaded.config,
        );
        const instance = instantiate(
          loaded.module,
          iface.className,
          options,
        ) as T;
        sharedInstances?.set(cacheKey, instance);
        instances.push(instance);
      } catch (error) {
        if (error instanceof SkipInstantiationError) {
          console.warn(
            `[dynamic] Skipping ${loaded.id}.${iface.className}: ${error.message}`,
          );
          continue;
        }
        throw error;
      }
    }
  }

  return instances;
}

function requireFirst<T>(instances: T[], kind: string): T {
  const first = instances[0];
  if (!first) {
    throw new Error(`agent-conf must declare at least one ${kind} package`);
  }
  return first;
}

function buildOptions(
  config: readonly RegistryConfigEntry[] | undefined,
  env: Environment,
  extras: Record<string, unknown>,
  yamlConfig?: Record<string, unknown>,
): Record<string, unknown> {
  const options: Record<string, unknown> = { ...extras };

  for (const entry of config ?? []) {
    let value: unknown = yamlConfig?.[entry.key];

    if (value === undefined || value === "") {
      value = entry.env !== undefined ? env.get(entry.env) : undefined;
    }

    if (value === undefined || value === "") {
      value = entry.default;
    }

    if ((value === undefined || value === "") && entry.required) {
      throw new SkipInstantiationError(
        `Missing required config "${entry.key}"${entry.env ? ` (${entry.env})` : ""}`,
      );
    }

    if (value !== undefined && value !== "") {
      options[entry.key] = coerceConfigValue(value, entry.type);
    }
  }

  // Allow arbitrary yaml keys beyond registry config schema.
  for (const [key, value] of Object.entries(yamlConfig ?? {})) {
    if (value !== undefined) {
      options[key] = value;
    }
  }

  if ("model" in options && !("models" in options)) {
    options.models = [options.model];
  }

  return options;
}

function coerceConfigValue(value: unknown, type: string | undefined): unknown {
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`Invalid number config value: ${String(value)}`);
    }
    return number;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0") {
      return false;
    }
    throw new Error(`Invalid boolean config value: ${String(value)}`);
  }
  return value;
}

function instantiate(
  module: CapabilityModule,
  className: string,
  options: Record<string, unknown>,
): unknown {
  const Ctor = getConstructor(module, className);
  if (!Ctor) {
    throw new Error(`Module does not export class "${className}"`);
  }

  try {
    return new Ctor(options);
  } catch (error) {
    if (Object.keys(options).length > 0) {
      try {
        return new Ctor();
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

function getConstructor(
  module: CapabilityModule,
  className: string,
): AnyConstructor | undefined {
  const value = module[className];
  return typeof value === "function" ? (value as AnyConstructor) : undefined;
}

function interfacesFor(
  packageId: string,
  kind: CapabilityType,
  registry: RegistryIndex,
  installedInterfaces?: readonly string[],
): RegistryInterface[] {
  const pkg = registry.packages.find((entry) => entry.id === packageId);
  if (!pkg) {
    throw new Error(
      `Package "${packageId}" not found in registry index (.agent-os/registry/index.json)`,
    );
  }
  return pkg.interfaces.filter(
    (iface) =>
      iface.kind === kind &&
      (!installedInterfaces || installedInterfaces.includes(iface.id)),
  );
}

async function loadRegistryIndex(): Promise<RegistryIndex> {
  const indexPath = join(repositoryRoot, ".agent-os/registry/index.json");
  const raw = JSON.parse(await readFile(indexPath, "utf8")) as RegistryIndex;
  if (!Array.isArray(raw.packages)) {
    throw new Error(`Invalid registry index at ${indexPath}`);
  }
  return raw;
}

function overlayLoadedManifests(
  registry: RegistryIndex,
  init: InitConf,
): void {
  const loadedPackages = new Map<string, LoadedPackage>();
  for (const modules of Object.values(init.modules)) {
    for (const loaded of modules) {
      loadedPackages.set(loaded.id, loaded);
    }
  }

  for (const loaded of loadedPackages.values()) {
    const interfaces = loaded.manifest.interfaces.map((iface) => {
      if (typeof iface.className !== "string" || iface.className === "") {
        throw new Error(
          `Package "${loaded.id}" interface "${iface.id}" has no className`,
        );
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
    const replacement: RegistryPackage = {
      id: loaded.id,
      interfaces,
    };
    const index = registry.packages.findIndex(
      (entry) => entry.id === loaded.id,
    );
    if (index >= 0) {
      registry.packages[index] = replacement;
    } else {
      registry.packages.push(replacement);
    }
  }
}
