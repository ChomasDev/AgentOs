import assert from "node:assert/strict";
import test from "node:test";
import { TelegramOutput } from "../src/index.js";

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
