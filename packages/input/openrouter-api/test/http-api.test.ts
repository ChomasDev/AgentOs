import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { InputListener, InputMessage } from "@agent-os/core/domain";
import { OpenRouterApiInput } from "../src/index.js";

test("serves health and advertised models", async () => {
  const api = new OpenRouterApiInput({
    port: 0,
    log: false,
    models: [{ id: "agent-os", name: "Agent OS", contextLength: 128_000 }],
  });

  await withServer(api, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      service: "agent-os-openrouter-api",
    });

    const response = await fetch(`${baseUrl}/v1/models`);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(response.status, 200);
    assert.equal(body.data[0]?.id, "agent-os");
    assert.equal(body.data[0]?.context_length, 128_000);
  });
});

test("correlates a chat request with its JSON response", async () => {
  let received: InputMessage | undefined;
  const api = new OpenRouterApiInput({ port: 0, log: false });
  const listener: InputListener = async (message) => {
    received = message;
    await api.write("Hello from Agent OS");
  };

  await withServer(api, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": "header-session" },
      body: JSON.stringify({
        model: "agent-os",
        session_id: "web-1",
        user: "user-1",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    const body = (await response.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
    };

    assert.equal(response.status, 200);
    assert.match(body.id, /^chatcmpl-/);
    assert.equal(body.choices[0]?.message.content, "Hello from Agent OS");
    assert.equal(received?.sessionId, "web-1");
    assert.equal(received?.userId, "user-1");
    assert.match(received?.text ?? "", /USER:\nHello/);
  }, listener);
});

test("streams responses and rejects invalid bearer tokens", async () => {
  const api = new OpenRouterApiInput({
    port: 0,
    log: false,
    apiKey: "secret",
  });
  const listener: InputListener = async () => {
    await api.write(toStream(["A streaming response"]));
  };

  await withServer(api, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/v1/models`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "agent-os",
        stream: true,
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.match(body, /A streaming response/);
    assert.match(body, /data: \[DONE\]/);
  }, listener);
});

async function withServer(
  api: OpenRouterApiInput,
  task: (baseUrl: string) => Promise<void>,
  listener: InputListener = () => undefined,
): Promise<void> {
  const running = api.start(listener);
  try {
    const address = await waitForAddress(api);
    await task(`http://127.0.0.1:${address.port}`);
  } finally {
    await api.stop();
    await running;
  }
}

async function waitForAddress(api: OpenRouterApiInput): Promise<AddressInfo> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const address = api.address;
    if (typeof address === "object" && address) return address;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("OpenRouter API did not start listening");
}

async function* toStream(chunks: readonly string[]): AsyncGenerator<string> {
  yield* chunks;
}
