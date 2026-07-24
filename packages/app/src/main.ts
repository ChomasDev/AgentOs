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
import {
  OpenRouterApiInput,
  type OpenRouterApiLogEvent,
} from "@agent-os/input-openrouter-api";
import { CLIInput, CLIOutput } from "@agent-os/io-cli";
import { CodexProvider } from "@agent-os/ai-codex";
import { DefaultOrchestrator } from "@agent-os/orchestrator-default";
import type { InputInterface } from "@agent-os/core/domain";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OS from "./Os/index.js";

const envFilePath = fileURLToPath(new URL("../../../.env", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const env = new CompositeEnvironment([
  new ProcessEnvironment(),
  new DotenvEnvironment({ filePath: envFilePath }),
]);

const model = new CodexProvider({
  model: env.getOrDefault("CODEX_MODEL", "gpt-5.6-sol"),
  workingDirectory: repositoryRoot,
});
const cronjobs = new CronjobInput({
  databasePath: env.getOrDefault(
    "CRONJOB_DB_PATH",
    resolve(repositoryRoot, ".agent-os/cronjobs.sqlite"),
  ),
});
const openRouterApi = new OpenRouterApiInput({
  hostname: env.getOrDefault("OPENROUTER_API_HOST", "127.0.0.1"),
  port: parsePort(env.getOrDefault("OPENROUTER_API_PORT", "3000")),
  apiKey: env.get("OPENROUTER_API_KEY"),
  models: [env.getOrDefault("OPENROUTER_API_MODEL", "agent-os")],
  corsOrigins: parseCorsOrigins(
    env.getOrDefault("OPENROUTER_API_CORS_ORIGINS", "*"),
  ),
  onLog: logOpenRouterApi,
});
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

function shouldEnableCliInput(): boolean {
  if (process.stdin.isTTY) {
    // Interactive terminal: read prompts from the keyboard.
    return true;
  }

  // Non-interactive (piped) stdin: only enable CLI for a one-shot argv prompt.
  return hasOneShotCliPrompt();
}

function hasOneShotCliPrompt(): boolean {
  return process.argv
    .slice(2)
    .some((value) => value !== "--" && value.trim() !== "");
}

// A one-shot CLI invocation should finish after its response instead of
// waiting indefinitely for long-running inputs such as cron.
const persistentMode = !hasOneShotCliPrompt();
const inputs: InputInterface[] = persistentMode
  ? [cronjobs, openRouterApi]
  : [];
if (shouldEnableCliInput()) {
  inputs.unshift(new CLIInput({ onInterrupt: shutdown }));
}
const cliOutput = new CLIOutput();
const outputs = persistentMode
  ? [cliOutput, openRouterApi]
  : [cliOutput];
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
const orchestrator = new DefaultOrchestrator({
  model,
  capabilityDiscovery,
});

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
  await cronjobs.close();
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid OPENROUTER_API_PORT: "${value}"`);
  }

  return port;
}

function parseCorsOrigins(
  value: string,
): "*" | readonly string[] | false {
  const normalized = value.trim();

  if (normalized === "*") {
    return "*";
  }

  if (normalized.toLowerCase() === "false") {
    return false;
  }

  return normalized
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function logOpenRouterApi(event: OpenRouterApiLogEvent): void {
  switch (event.type) {
    case "listening":
      console.log(
        `[OPENROUTER] Listening on ${event.url}/api/v1/chat/completions`,
      );
      break;
    case "request.started":
      console.log(
        `[OPENROUTER] ${event.method} ${event.path} (${event.requestId})`,
      );
      break;
    case "request.completed":
      console.log(
        `[OPENROUTER] ${event.status} ${event.method} ${event.path} ${event.durationMs}ms`,
      );
      break;
    case "request.failed":
      console.error(
        `[OPENROUTER] Failed ${event.method} ${event.path}: ${event.error}`,
      );
      break;
    case "stopped":
      console.log("[OPENROUTER] Server stopped");
      break;
  }
}
