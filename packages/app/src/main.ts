import { RunCLICommandCapability } from "@agent-os/action-cli";
import { PerplexitySearchCapability } from "@agent-os/action-perplexityserach";
import { DefaultAgentLoop } from "@agent-os/agent-loop";
import { InMemoryCapabilityDiscovery } from "@agent-os/discovery-memory";
import { CLIInput, CLIOutput } from "@agent-os/io-cli";
import { OpenAIProvider } from "@agent-os/openai";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import OS from "./Os/index.js";

const envFilePath = fileURLToPath(
  new URL("../../../.env", import.meta.url),
);
const repositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);

try {
  loadEnvFile(envFilePath);
} catch (error) {
  if (!isMissingEnvFileError(error)) {
    throw error;
  }
}

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is required. Add it to .env or export it in your shell.",
  );
}

const model = new OpenAIProvider({
  apiKey,
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
});
const input = new CLIInput();
const output = new CLIOutput();
const capabilityDiscovery = new InMemoryCapabilityDiscovery();

await capabilityDiscovery.register(
  new RunCLICommandCapability({
    cwd: repositoryRoot,
  }),
);

const perplexityApiKey = process.env.PERPLEXITY_API_KEY;


if (perplexityApiKey) {
  await capabilityDiscovery.register(
    new PerplexitySearchCapability({
      apiKey: perplexityApiKey,
    }),
  );
}

const agentLoop = new DefaultAgentLoop({
  model,
  capabilityDiscovery,
});

const os = new OS();

os.boot({
  agentLoop,
  input,
  output,
  settings: {
    agentic: true,
    stream: process.env.AI_STREAM !== "false",
    showSteps: process.env.AI_SHOW_STEPS !== "false",
  },
});

await os.startListener();

function isMissingEnvFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
