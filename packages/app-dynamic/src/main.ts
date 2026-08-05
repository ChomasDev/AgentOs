import { fileURLToPath } from "node:url";
import { bootFromInit } from "./utils/bootFromInit.js";
import { getInitConf } from "./utils/getinitConf.js";

console.log("@agent-os/app-dynamic starting");

const agentConfPath = fileURLToPath(
  new URL("./agent-conf.yaml", import.meta.url),
);

const init = await getInitConf(agentConfPath);

console.log("[dynamic] Loaded packages:", {
  schemaVersion: init.conf.schemaVersion,
  input: init.modules.input.map((entry) =>
    entry.config ? { id: entry.id, config: entry.config } : entry.id,
  ),
  output: init.modules.output.map((entry) =>
    entry.config ? { id: entry.id, config: entry.config } : entry.id,
  ),
  action: init.modules.action.map((entry) => entry.id),
  agent: init.modules.agent.map((entry) => entry.id),
  orchestrator: init.modules.orchestrator.map((entry) => entry.id),
  discovery: init.modules.discovery.map((entry) => entry.id),
  database: init.modules.database.map((entry) => entry.id),
  memory: init.modules.memory.map((entry) => entry.id),
  ai: init.modules.ai.map((entry) => entry.id),
  env: init.modules.env.map((entry) => entry.id),
});

await bootFromInit(init);
