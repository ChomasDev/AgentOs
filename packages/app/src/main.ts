import { RunCLICommandCapability } from "@agent-os/action-cli";
import { PerplexitySearchCapability } from "@agent-os/action-perplexityserach";
import { DefaultAgentLoop } from "@agent-os/agent-loop";
import { InMemoryCapabilityDiscovery } from "@agent-os/discovery-memory";
import {
  CompositeEnvironment,
  DotenvEnvironment,
  ProcessEnvironment,
} from "@agent-os/env-node";
import {
  CronjobInput,
  ManageCronjobsCapability,
} from "@agent-os/input-cronjob";
import { CLIInput, CLIOutput } from "@agent-os/io-cli";
import { OpenAIProvider } from "@agent-os/openai";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OS from "./Os/index.js";

const envFilePath = fileURLToPath(new URL("../../../.env", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const env = new CompositeEnvironment([
  new ProcessEnvironment(),
  new DotenvEnvironment({ filePath: envFilePath }),
]);

const model = new OpenAIProvider({
  env,
  model: env.getOrDefault("OPENAI_MODEL", "gpt-5.6"),
});
const cronjobs = new CronjobInput({
  databasePath: env.getOrDefault(
    "CRONJOB_DB_PATH",
    resolve(repositoryRoot, ".agent-os/cronjobs.sqlite"),
  ),
});
if (!cronjobs.getCronjob("test2")) {
  cronjobs.addCronjob({
    cronExpression: "* * * * *",
    name: "test2",
    prompt: "What is the current time?",
  });
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

const hasCliArguments = process.argv
  .slice(2)
  .some((value) => value !== "--" && value.trim() !== "");
const inputs = [
  ...(process.stdin.isTTY || hasCliArguments
    ? [new CLIInput({ onInterrupt: shutdown })]
    : []),
  cronjobs,
];
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

await capabilityDiscovery.register(new ManageCronjobsCapability(cronjobs));

const agentLoop = new DefaultAgentLoop({
  model,
  capabilityDiscovery,
});

os.boot({
  agentLoop,
  env,
  input: inputs,
  output,
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
  await cronjobs.close();
}
