import type {
  AgentLoop,
  Environment,
  InputInterface,
  InputListener,
  Orchestrator,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";
import assert from "node:assert/strict";
import test from "node:test";
import OS from "../src/Os/index.js";

test("delivers the generated response and a separate web acknowledgement", async () => {
  const writes = new Map<string, string[]>();
  const input: InputInterface = {
    channel: "web",
    async start(listener: InputListener) {
      await listener({
        id: "message-1",
        channel: "web",
        sessionId: "session-1",
        text: "Write me a message about the stats of the current repo",
        createdAt: new Date(),
      });
    },
    async stop() {},
  };
  const orchestrator: Orchestrator = {
    async orchestrate() {
      return {
        capabilityIds: ["repo.stats"],
        outputChannel: "telegram",
        additionalOutputs: [
          {
            outputChannel: "web",
            content: "text",
            text: "Okay, done.",
          },
        ],
      };
    },
  };
  const agentLoop: AgentLoop = {
    async run() {
      return {
        type: "text",
        text: "Repository stats: 42 files.",
      };
    },
  };
  const os = new OS();

  os.boot({
    agentLoop,
    env: emptyEnvironment,
    input: [input],
    orchestrator,
    output: [
      captureOutput("web", writes),
      captureOutput("telegram", writes),
    ],
    settings: {
      agentic: true,
      stream: true,
      showSteps: false,
    },
  });

  await os.startListener();

  assert.deepEqual(writes.get("telegram"), [
    "Repository stats: 42 files.",
  ]);
  assert.deepEqual(writes.get("web"), ["Okay, done."]);
});

const emptyEnvironment: Environment = {
  get: () => undefined,
  getRequired(key) {
    throw new Error(`Missing ${key}`);
  },
  getOrDefault: (_key, fallback) => fallback,
  has: () => false,
  getAll: () => ({}),
};

function captureOutput(
  channel: string,
  writes: Map<string, string[]>,
): OutputInterface {
  return {
    channel,
    async write(content: OutputContent) {
      const text =
        typeof content === "string"
          ? content
          : await collectStream(content);
      const channelWrites = writes.get(channel) ?? [];
      channelWrites.push(text);
      writes.set(channel, channelWrites);
    },
  };
}

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks.join("");
}
