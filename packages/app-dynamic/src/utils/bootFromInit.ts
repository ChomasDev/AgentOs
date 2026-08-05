import type {
  AgentLoop,
  AIProvider,
  Capability,
  CapabilityDiscovery,
  DatabaseProvider,
  InputInterface,
  Memory,
  Orchestrator,
  OutputInterface,
} from "@agent-os/core/domain";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OS from "../Os/index.js";
import {
  createEnvironment,
  createKindInstances,
  requireFirst,
} from "./component-factory.js";
import type { InitConf } from "./getinitConf.js";
import {
  loadRegistryIndex,
  overlayLoadedManifests,
} from "./package-registry.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export async function bootFromInit(init: InitConf): Promise<void> {
  const registry = await loadRegistryIndex(repositoryRoot);
  overlayLoadedManifests(registry, init);
  const env = createEnvironment(init.modules.env, registry, repositoryRoot);

  const database = requireFirst(
    createKindInstances<DatabaseProvider>(
      init.modules.database,
      "database",
      registry,
      { cwd: repositoryRoot },
      env,
    ),
    "database",
  );

  const memory = requireFirst(
    createKindInstances<Memory>(
      init.modules.memory,
      "memory",
      registry,
      { cwd: repositoryRoot },
      env,
      database,
    ),
    "memory",
  );

  const model = requireFirst(
    createKindInstances<AIProvider>(
      init.modules.ai,
      "ai",
      registry,
      { workingDirectory: repositoryRoot },
      env,
      database,
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
      database,
    ),
    "discovery",
  );

  const shutdownRef: { current?: () => void } = {};
  const sharedInstances = new Map<string, unknown>();
  const databasePath = env.getOrDefault(
    "CRONJOB_DB_PATH",
    resolve(repositoryRoot, ".agent-os/cronjobs.sqlite"),
  );
  const inputs = createKindInstances<InputInterface>(
    init.modules.input,
    "input",
    registry,
    {
      env,
      databasePath,
      onInterrupt: () => shutdownRef.current?.(),
      workingDirectory: repositoryRoot,
    },
    env,
    database,
    sharedInstances,
  );

  for (const action of createKindInstances<Capability>(
    init.modules.action,
    "action",
    registry,
    { env, cwd: repositoryRoot, databasePath },
    env,
    database,
    sharedInstances,
  )) {
    await initializeCapability(action);
    await capabilityDiscovery.register(action);
  }

  // Actions that live on input packages (e.g. cronjob manage) when not listed under action.
  for (const loaded of init.modules.input) {
    if (init.modules.action.some((entry) => entry.id === loaded.id)) continue;
    for (const action of createKindInstances<Capability>(
      [loaded],
      "action",
      registry,
      { env, cwd: repositoryRoot, databasePath },
      env,
      database,
      sharedInstances,
    )) {
      await initializeCapability(action);
      await capabilityDiscovery.register(action);
    }
  }

  const agentLoop = requireFirst(
    createKindInstances<AgentLoop>(
      init.modules.agent,
      "agent",
      registry,
      { model, capabilityDiscovery },
      env,
      database,
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
      database,
    ),
    "orchestrator",
  );

  const outputs = createKindInstances<OutputInterface>(
    init.modules.output,
    "output",
    registry,
    { env },
    env,
    database,
    sharedInstances,
  );

  const closers: Array<() => Promise<void>> = [];
  for (const input of inputs) {
    const maybeClose = (input as { close?: () => Promise<void> }).close;
    if (typeof maybeClose === "function") {
      closers.push(() => maybeClose.call(input));
    }
  }
  if (typeof memory.close === "function") {
    closers.push(() => memory.close!());
  }
  if (typeof database.close === "function") {
    closers.push(() => database.close!());
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
    memory,
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
