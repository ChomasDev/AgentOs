import { getOrDownloadCapability } from "./getCapability.js";
import {
  loadAgentConfYaml,
  type AgentConf,
} from "./yarml-parser.js";

export type CapabilityModule = Record<string, unknown>;

export interface InitConfModules {
  input: CapabilityModule[];
  output: CapabilityModule[];
  action: CapabilityModule[];
  agent: CapabilityModule[];
  orchestrator: CapabilityModule[];
  discovery: CapabilityModule[];
  ai: CapabilityModule[];
  env: CapabilityModule[];
}

export interface InitConf {
  conf: AgentConf;
  modules: InitConfModules;
}

export async function getInitConf(agentConfPath: string): Promise<InitConf> {
  const conf = await loadAgentConfYaml(agentConfPath);

  const [
    input,
    output,
    action,
    agent,
    orchestrator,
    discovery,
    ai,
    env,
  ] = await Promise.all([
    Promise.all(
      conf.interfaces.input.map((capability) =>
        getOrDownloadCapability(capability, "input"),
      ),
    ),
    Promise.all(
      conf.interfaces.output.map((capability) =>
        getOrDownloadCapability(capability, "output"),
      ),
    ),
    Promise.all(
      conf.interfaces.action.map((capability) =>
        getOrDownloadCapability(capability, "action"),
      ),
    ),
    Promise.all(
      conf.interfaces.agent.map((capability) =>
        getOrDownloadCapability(capability, "agent"),
      ),
    ),
    Promise.all(
      conf.interfaces.orchestrator.map((capability) =>
        getOrDownloadCapability(capability, "orchestrator"),
      ),
    ),
    Promise.all(
      conf.interfaces.discovery.map((capability) =>
        getOrDownloadCapability(capability, "discovery"),
      ),
    ),
    Promise.all(
      conf.interfaces.ai.map((capability) =>
        getOrDownloadCapability(capability, "ai"),
      ),
    ),
    Promise.all(
      conf.interfaces.env.map((capability) =>
        getOrDownloadCapability(capability, "env"),
      ),
    ),
  ]);

  return {
    conf,
    modules: {
      input,
      output,
      action,
      agent,
      orchestrator,
      discovery,
      ai,
      env,
    },
  };
}
