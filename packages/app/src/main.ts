import { RunCLICommandCapability } from "@agent-os/action-cli";
import { PerplexitySearchCapability } from "@agent-os/action-perplexityserach";
import { DefaultAgentLoop } from "@agent-os/agent-loop";
import { InMemoryCapabilityDiscovery } from "@agent-os/discovery-memory";
import {
  CompositeEnvironment,
  DotenvEnvironment,
  ProcessEnvironment,
} from "@agent-os/env-node";
import { CLIInput, CLIOutput } from "@agent-os/io-cli";
import { OpenAIProvider } from "@agent-os/openai";
import { fileURLToPath } from "node:url";
import OS from "./Os/index.js";

const envFilePath = fileURLToPath(
  new URL("../../../.env", import.meta.url),
);
const repositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);

const env = new CompositeEnvironment([
  new ProcessEnvironment(),
  new DotenvEnvironment({ filePath: envFilePath }),
]);

const model = new OpenAIProvider({
  env,
  model: env.getOrDefault("OPENAI_MODEL", "gpt-5.6"),
});
const input = new CLIInput();
const output = new CLIOutput();
const capabilityDiscovery = new InMemoryCapabilityDiscovery();

await capabilityDiscovery.register(
  new RunCLICommandCapability({
    cwd: repositoryRoot,
    env,
  }),
);

await capabilityDiscovery.register(
  new PerplexitySearchCapability({
    env,
  }),
);

const agentLoop = new DefaultAgentLoop({
  model,
  capabilityDiscovery,
});

const os = new OS();

os.boot({
  agentLoop,
  env,
  input,
  output,
  settings: {
    agentic: true,
    stream: env.getOrDefault("AI_STREAM", "true") !== "false",
    showSteps: env.getOrDefault("AI_SHOW_STEPS", "true") !== "false",
  },
});

await os.startListener();
