import assert from "node:assert/strict";
import test from "node:test";
import type { InputMessage, OutputInterface } from "@agent-os/core/domain";
import {
  addDeliveryContext,
  selectProgressOutput,
} from "../src/Os/delivery-context.js";

const outputs: OutputInterface[] = [
  { channel: "cli", async write() {} },
  { channel: "telegram", async write() {} },
];

test("explains cross-channel delivery to the agent", () => {
  const routed = addDeliveryContext(message("cli"), "telegram");
  assert.match(routed.text, /deliver your final response to the telegram output/);
  assert.match(routed.text, /Do not claim that delivery requires a tool/);
});

test("sends progress only to an originating CLI", () => {
  assert.equal(selectProgressOutput(message("cli"), outputs)?.channel, "cli");
  assert.equal(selectProgressOutput(message("telegram"), outputs), undefined);
});

function message(channel: string): InputMessage {
  return {
    id: "message-1",
    channel,
    sessionId: "session-1",
    text: "Send a greeting on Telegram",
    createdAt: new Date(),
  };
}
