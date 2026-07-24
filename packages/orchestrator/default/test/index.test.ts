import type {
  AIFunctionCallResult,
  AIProvider,
  CapabilityDiscovery,
  OutputInterface,
} from "@agent-os/core/domain";
import assert from "node:assert/strict";
import test from "node:test";
import { DefaultOrchestrator } from "../src/index.js";

test("keeps a valid Telegram response route and web acknowledgement", async () => {
  const model = {
    provider: "test",
    model: "test",
    settings: {},
    async functionCall<TArguments>() {
      return {
        type: "function-call",
        name: "route_agent_message",
        callId: "call-1",
        arguments: {
          capabilityIds: [],
          outputChannel: "telegram",
          additionalOutputs: [
            {
              outputChannel: "web",
              content: "text",
              text: "Okay, done.",
            },
          ],
          reason: "Deliver the report to Telegram and acknowledge on web.",
        },
      } as AIFunctionCallResult<TArguments>;
    },
  } as unknown as AIProvider;
  const capabilityDiscovery = {
    async discover() {
      return [];
    },
  } as unknown as CapabilityDiscovery;
  const outputs: OutputInterface[] = [
    { channel: "web", async write() {} },
    { channel: "telegram", async write() {} },
  ];
  const orchestrator = new DefaultOrchestrator({
    model,
    capabilityDiscovery,
  });

  const decision = await orchestrator.orchestrate(
    {
      id: "message-1",
      channel: "web",
      sessionId: "session-1",
      text: "Write me a message about the stats of the current repo",
      createdAt: new Date(),
    },
    outputs,
  );

  assert.equal(decision.outputChannel, "telegram");
  assert.deepEqual(decision.additionalOutputs, [
    {
      outputChannel: "web",
      content: "text",
      text: "Okay, done.",
    },
  ]);
});
