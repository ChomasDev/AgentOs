import type { CapabilityType } from "@agent-os/core/domain";
import { getOrDownloadCapability } from "./getCapability.js";
import {
  loadAgentConfYaml,
  type AgentConf,
  type AgentInterfaceKind,
} from "./yarml-parser.js";

export type CapabilityModule = Record<string, unknown>;

export interface LoadedPackage {
  id: string;
  kind: CapabilityType;
  module: CapabilityModule;
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

  await Promise.all(
    KINDS.map(async (kind) => {
      modules[kind] = await Promise.all(
        conf.interfaces[kind].map(async (id) => ({
          id,
          kind,
          module: await getOrDownloadCapability(id, kind),
        })),
      );
    }),
  );

  return { conf, modules };
}
