import assert from "node:assert/strict";
import test from "node:test";
import { TelegramAdapter, TelegramOutput } from "../src/index.js";

test("sends text to the configured chat and splits long messages", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const output = new TelegramOutput({
    botToken: "bot-token",
    chatId: "chat-123",
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await output.write("x".repeat(4_097));

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0]?.url,
    "https://api.telegram.org/botbot-token/sendMessage",
  );
  assert.deepEqual(requests.map(({ body }) => body), [
    { chat_id: "chat-123", text: "x".repeat(4_096) },
    { chat_id: "chat-123", text: "x" },
  ]);
});

test("keeps a per-chat session and rotates it on /new", async () => {
  const sent: Array<{ chat_id: string; text: string }> = [];
  const received: Array<{ text: string; sessionId: string }> = [];
  let updatesReturned = false;
  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    fetch: async (input, init) => {
      const method = String(input).split("/").at(-1);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (method === "sendMessage") {
        sent.push(body as { chat_id: string; text: string });
        return jsonResponse({ ok: true });
      }
      if (updatesReturned) return jsonResponse({ ok: true, result: [] });
      updatesReturned = true;
      return jsonResponse({
        ok: true,
        result: [
          update(1, 10, "hello"),
          update(2, 11, "/new"),
          update(3, 12, "hello again"),
        ],
      });
    },
  });

  await adapter.start(async (message) => {
    received.push({ text: message.text, sessionId: message.sessionId });
    await adapter.write(`reply: ${message.text}`);
    if (received.length === 2) await adapter.stop();
  });

  assert.equal(received.length, 2);
  assert.notEqual(received[0]?.sessionId, received[1]?.sessionId);
  assert.deepEqual(sent, [
    { chat_id: "123", text: "reply: hello" },
    { chat_id: "123", text: "Started a new conversation." },
    { chat_id: "123", text: "reply: hello again" },
  ]);
});

function update(updateId: number, messageId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: 1_700_000_000,
      text,
      chat: { id: 123 },
      from: { id: 456 },
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
