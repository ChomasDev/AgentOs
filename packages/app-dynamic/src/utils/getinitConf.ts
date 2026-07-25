import type { CapabilityType } from "@agent-os/core/domain";
import { getOrDownloadCapability } from "./getCapability.js";
import {
  loadAgentConfYaml,
  type AgentConf,
  type AgentInterfaceKind,
  type PackageConf,
} from "./yarml-parser.js";

export type CapabilityModule = Record<string, unknown>;

export interface LoadedPackage {
  id: string;
  kind: CapabilityType;
  module: CapabilityModule;
  config?: Record<string, unknown>;
  installedInterfaces: readonly string[];
}

export interface InitConfModules {
  input: LoadedPackage[];
  output: LoadedPackage[];
  action: LoadedPackage[];
  agent: LoadedPackage[];
  orchestrator: LoadedPackage[];
  discovery: LoadedPackage[];
  ai: LoadedPackage[];
  env: LoadedPackage[];
}

export interface InitConf {
  conf: AgentConf;
  modules: InitConfModules;
}

const KINDS = [
  "input",
  "output",
  "action",
  "agent",
  "orchestrator",
  "discovery",
  "ai",
  "env",
] as const satisfies readonly AgentInterfaceKind[];

export async function getInitConf(agentConfPath: string): Promise<InitConf> {
  const conf = await loadAgentConfYaml(agentConfPath);
  const modules = {} as InitConfModules;
  const requestedKinds = new Map<string, Set<AgentInterfaceKind>>();
  for (const kind of KINDS) {
    for (const entry of conf.interfaces[kind]) {
      const kinds = requestedKinds.get(entry.id) ?? new Set();
      kinds.add(kind);
      requestedKinds.set(entry.id, kinds);
    }
  }

  const installed = new Map(
    await Promise.all(
      [...requestedKinds].map(async ([id, kinds]) => [
        id,
        await getOrDownloadCapability(id, [...kinds]),
      ] as const),
    ),
  );

  for (const kind of KINDS) {
    modules[kind] = conf.interfaces[kind].flatMap((entry: PackageConf) => {
      const loaded = installed.get(entry.id);
      if (!loaded || !loaded.manifest.interfaces.some(
        (iface) =>
          iface.kind === kind && loaded.installedInterfaces.includes(iface.id),
      )) {
        console.warn(
          `[dynamic] ${entry.id}.${kind} was not selected for installation; skipping`,
        );
        return [];
      }
      return [{
        id: entry.id,
        kind,
        config: entry.config,
        module: loaded.module,
        installedInterfaces: loaded.installedInterfaces,
      }];
    });
  }

  // A selected component may have been added by the user or by `required`.
  // Activate it even when agent-conf only mentioned another kind from the bundle.
  for (const [id, loaded] of installed) {
    const fallbackConfig = KINDS
      .flatMap((kind) => conf.interfaces[kind])
      .find((entry) => entry.id === id)?.config;

    for (const kind of KINDS) {
      const hasSelectedKind = loaded.manifest.interfaces.some(
        (iface) =>
          iface.kind === kind && loaded.installedInterfaces.includes(iface.id),
      );
      if (
        hasSelectedKind &&
        !modules[kind].some((entry) => entry.id === id)
      ) {
        modules[kind].push({
          id,
          kind,
          config: fallbackConfig,
          module: loaded.module,
          installedInterfaces: loaded.installedInterfaces,
        });
      }
    }
  }

  return { conf, modules };
}
