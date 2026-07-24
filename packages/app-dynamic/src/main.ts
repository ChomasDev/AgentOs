import type {
  AgentLoop,
  AIProvider,
  Capability,
  CapabilityDiscovery,
  Environment,
  InputInterface,
  Orchestrator,
  OutputInterface,
} from "@agent-os/core/domain";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getInitConf,
} from "./utils/getinitConf.js";

console.log("@agent-os/app-dynamic starting");

const agentConfPath = fileURLToPath(
  new URL("./agent-conf.yaml", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envFilePath = resolve(repositoryRoot, ".env");

const { conf, modules } = await getInitConf(agentConfPath);

console.log("[dynamic] Loaded modules:", {
  schemaVersion: conf.schemaVersion,
  input: modules.input.length,
  output: modules.output.length,
  action: modules.action.length,
  agent: modules.agent.length,
  orchestrator: modules.orchestrator.length,
  discovery: modules.discovery.length,
  ai: modules.ai.length,
  env: modules.env.length,
});
