import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  InputInterface,
  InputListener,
  InputMessage,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";

export interface OpenRouterApiModel {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
}

export type OpenRouterApiLogEvent =
  | {
      type: "listening";
      url: string;
    }
  | {
      type: "request.started";
      requestId: string;
      method: string;
      path: string;
    }
  | {
      type: "request.completed";
      requestId: string;
      method: string;
      path: string;
      status: number;
      durationMs: number;
    }
  | {
      type: "request.failed";
      requestId: string;
      method: string;
      path: string;
      error: string;
    }
  | {
      type: "stopped";
    };

export interface OpenRouterApiInputOptions {
  hostname?: string;
  port?: number;
  apiKey?: string;
  sessionId?: string;
  models?: readonly (string | OpenRouterApiModel)[];
  corsOrigins?: "*" | readonly string[] | false;
  maxBodyBytes?: number;
  chatCompletionsPaths?: readonly string[];
  onLog?: (event: OpenRouterApiLogEvent) => void;
}

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  user?: string;
  session_id?: string;
  [key: string]: unknown;
}

interface BufferedOutput {
  chunks: string[];
}

interface ResponseContext {
  request: ChatCompletionRequest;
  response: ServerResponse;
  completionId: string;
  created: number;
  outputs: BufferedOutput[];
  responded: boolean;
}

const defaultChatPaths = [
  "/v1/chat/completions",
  "/api/v1/chat/completions",
] as const;

const modelPaths = new Set(["/v1/models", "/api/v1/models"]);

/**
 * OpenAI/OpenRouter-compatible HTTP input and output adapter.
 *
 * Register the same instance in both OSBootOptions.input and
 * OSBootOptions.output so responses remain correlated with their HTTP request.
 */
export class OpenRouterApiInput
  implements InputInterface, OutputInterface
{
  readonly channel = "openrouter-api" as const;
  readonly description =
    "The OpenRouter-compatible HTTP request that originated this message";

  private readonly options: Required<
    Pick<
      OpenRouterApiInputOptions,
      "hostname" | "port" | "maxBodyBytes" | "chatCompletionsPaths"
    >
  > &
    Omit<
      OpenRouterApiInputOptions,
      "hostname" | "port" | "maxBodyBytes" | "chatCompletionsPaths"
    >;
  private readonly contexts = new AsyncLocalStorage<ResponseContext>();
  private readonly models: readonly OpenRouterApiModel[];

  private server?: Server;
  private listening = false;
  private stopped?: Promise<void>;
  private resolveStopped?: () => void;

  constructor(options: OpenRouterApiInputOptions = {}) {
    this.options = {
      ...options,
      hostname: options.hostname ?? "127.0.0.1",
      port: options.port ?? 3000,
      maxBodyBytes: Math.max(1, options.maxBodyBytes ?? 1_048_576),
      chatCompletionsPaths:
        options.chatCompletionsPaths ?? defaultChatPaths,
    };
    this.models = (options.models ?? ["agent-os"]).map((model) =>
      typeof model === "string" ? { id: model } : model,
    );
  }

  get address(): AddressInfo | string | null {
    return this.server?.address() ?? null;
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("OpenRouterApiInput listener is already running");
    }

    this.listening = true;
    this.stopped = new Promise<void>((resolveStopped) => {
      this.resolveStopped = resolveStopped;
    });
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response, listener);
    });
    this.server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });

    try {
      await listen(
        this.server,
        this.options.port,
        this.options.hostname,
      );
      const address = this.address;
      const port =
        typeof address === "object" && address
          ? address.port
          : this.options.port;
      this.log({
        type: "listening",
        url: `http://${this.options.hostname}:${port}`,
      });
      await this.stopped;
    } catch (error) {
      this.listening = false;
      this.resolveStopped?.();
      throw error;
    } finally {
      this.server = undefined;
      this.stopped = undefined;
      this.resolveStopped = undefined;
      this.listening = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.listening) {
      return;
    }

    this.listening = false;
    const server = this.server;

    if (server?.listening) {
      await close(server);
    }

    this.log({ type: "stopped" });
    this.resolveStopped?.();
  }

  async write(content: OutputContent): Promise<void> {
    const context = this.contexts.getStore();

    if (!context) {
      throw new Error(
        "OpenRouterApiInput.write must run inside an active HTTP request",
      );
    }

    if (context.responded) {
      return;
    }

    if (typeof content === "string") {
      context.outputs.push({ chunks: [content] });
      return;
    }

    if (context.request.stream === true) {
      context.responded = true;
      await writeSse(context, content);
      return;
    }

    const chunks: string[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    context.outputs.push({ chunks });
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
  ): Promise<void> {
    const startedAt = Date.now();
    const requestId = `req-${randomUUID()}`;
    const method = request.method ?? "UNKNOWN";
    const path = new URL(
      request.url ?? "/",
      "http://agent-os.local",
    ).pathname;

    response.setHeader("x-request-id", requestId);
    this.log({
      type: "request.started",
      requestId,
      method,
      path,
    });

    try {
      this.applyCors(request, response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === "GET" && path === "/health") {
        writeJson(response, 200, {
          status: "ok",
          service: "agent-os-openrouter-api",
        });
        return;
      }

      this.authorize(request);

      if (request.method === "GET" && modelPaths.has(path)) {
        writeJson(response, 200, {
          object: "list",
          data: this.models.map((model) => ({
            id: model.id,
            object: "model",
            created: 0,
            owned_by: "agent-os",
            name: model.name,
            description: model.description,
            context_length: model.contextLength,
          })),
        });
        return;
      }

      if (
        request.method !== "POST" ||
        !this.options.chatCompletionsPaths.includes(path)
      ) {
        throw new HttpError(404, "Not found", "not_found");
      }

      const body = parseChatCompletionRequest(
        await readJsonBody(request, this.options.maxBodyBytes),
      );
      const completionId = `chatcmpl-${randomUUID()}`;
      const message = this.createMessage(request, body, completionId);
      const context: ResponseContext = {
        request: body,
        response,
        completionId,
        created: Math.floor(Date.now() / 1000),
        outputs: [],
        responded: false,
      };

      response.setHeader("x-request-id", completionId);

      await this.contexts.run(context, async () => {
        await listener(message);
      });

      if (context.responded || response.writableEnded) {
        return;
      }

      const output = context.outputs.at(-1);
      if (!output) {
        throw new HttpError(
          500,
          "Agent OS did not write a response to the openrouter-api output",
          "missing_output",
        );
      }

      context.responded = true;
      if (body.stream === true) {
        await writeSse(context, toAsyncIterable(output.chunks));
      } else {
        writeCompletion(context, output.chunks.join(""));
      }
    } catch (error) {
      this.log({
        type: "request.failed",
        requestId,
        method,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      writeError(response, error);
    } finally {
      this.log({
        type: "request.completed",
        requestId,
        method,
        path,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private createMessage(
    request: IncomingMessage,
    body: ChatCompletionRequest,
    completionId: string,
  ): InputMessage {
    const headerSessionId = firstHeader(request, "x-session-id");
    const sessionId =
      normalizeText(body.session_id) ??
      normalizeText(body.user) ??
      normalizeText(headerSessionId) ??
      this.options.sessionId ??
      `openrouter-${randomUUID()}`;

    return {
      id: `input-${randomUUID()}`,
      channel: this.channel,
      sessionId,
      text: renderConversation(body.messages),
      createdAt: new Date(),
      metadata: {
        preferredOutputChannel: this.channel,
        requestId: completionId,
        transport: "openrouter-api",
        model: body.model,
        stream: body.stream === true,
        remoteAddress: request.socket.remoteAddress,
      },
    };
  }

  private authorize(request: IncomingMessage): void {
    if (!this.options.apiKey) {
      return;
    }

    const authorization = firstHeader(request, "authorization");
    if (authorization !== `Bearer ${this.options.apiKey}`) {
      throw new HttpError(
        401,
        "Invalid or missing bearer token",
        "invalid_api_key",
      );
    }
  }

  private applyCors(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const configured = this.options.corsOrigins ?? "*";
    const origin = firstHeader(request, "origin");

    if (configured === false) {
      return;
    }

    if (
      configured !== "*" &&
      origin &&
      !configured.includes(origin)
    ) {
      throw new HttpError(403, "Origin is not allowed", "cors_error");
    }

    response.setHeader(
      "access-control-allow-origin",
      configured === "*" ? "*" : origin ?? configured[0] ?? "",
    );
    response.setHeader(
      "access-control-allow-headers",
      "authorization, content-type, x-session-id",
    );
    response.setHeader(
      "access-control-allow-methods",
      "GET, POST, OPTIONS",
    );
    response.setHeader(
      "access-control-expose-headers",
      "x-request-id",
    );
    response.setHeader("vary", "Origin");
  }

  private log(event: OpenRouterApiLogEvent): void {
    try {
      this.options.onLog?.(event);
    } catch {
      // Logging must never fail an API request or stop the server.
    }
  }
}

/** Backward-compatible spelling generated by addCapability. */
export { OpenRouterApiInput as OpenrouterApiInput };
export type OpenrouterApiInputOptions = OpenRouterApiInputOptions;

function parseChatCompletionRequest(
  value: unknown,
): ChatCompletionRequest {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Request body must be a JSON object",
      "invalid_request",
    );
  }

  const model = normalizeText(value.model);
  if (!model) {
    throw new HttpError(
      400,
      "The model field is required",
      "invalid_request",
    );
  }

  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    throw new HttpError(
      400,
      "The messages field must be a non-empty array",
      "invalid_request",
    );
  }

  const messages = value.messages.map(
    (message, index): ChatCompletionMessage => {
      if (!isRecord(message)) {
        throw new HttpError(
          400,
          `messages[${index}] must be an object`,
          "invalid_request",
        );
      }

      if (
        message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "tool"
      ) {
        throw new HttpError(
          400,
          `messages[${index}].role is invalid`,
          "invalid_request",
        );
      }

      return {
        role: message.role,
        content: message.content,
        name: normalizeText(message.name),
        tool_call_id: normalizeText(message.tool_call_id),
        tool_calls: message.tool_calls,
      };
    },
  );

  return {
    ...value,
    model,
    messages,
    stream: value.stream === true,
    user: normalizeText(value.user),
    session_id: normalizeText(value.session_id),
  };
}

function renderConversation(
  messages: readonly ChatCompletionMessage[],
): string {
  const hasContent = messages.some(
    (message) =>
      renderContent(message.content).trim() ||
      message.tool_calls !== undefined,
  );

  if (!hasContent) {
    throw new HttpError(
      400,
      "At least one message must contain text or tool calls",
      "invalid_request",
    );
  }

  const rendered = messages
    .map((message) => {
      const label = [
        message.role.toUpperCase(),
        message.name ? ` (${message.name})` : "",
        message.tool_call_id
          ? ` [tool_call_id=${message.tool_call_id}]`
          : "",
      ].join("");
      return [
        `${label}:`,
        renderContent(message.content),
        message.tool_calls === undefined
          ? ""
          : `Tool calls: ${serialize(message.tool_calls)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `Conversation supplied through an OpenRouter-compatible API:\n\n${rendered}`;
}

function renderContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content == null ? "" : serialize(content);
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return serialize(part);
      }

      if (
        (part.type === "text" || part.type === "input_text") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      if (part.type === "image_url") {
        const url =
          typeof part.image_url === "string"
            ? part.image_url
            : isRecord(part.image_url)
              ? normalizeText(part.image_url.url)
              : undefined;
        return url ? `[Image: ${url}]` : "[Image]";
      }

      return serialize(part);
    })
    .join("\n");
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;

  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk);
    size += chunk.byteLength;

    if (size > maxBodyBytes) {
      tooLarge = true;
    } else {
      chunks.push(chunk);
    }
  }

  if (tooLarge) {
    throw new HttpError(
      413,
      `Request body exceeds ${maxBodyBytes} bytes`,
      "request_too_large",
    );
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "Request body must contain valid JSON",
      "invalid_json",
    );
  }
}

function writeCompletion(
  context: ResponseContext,
  content: string,
): void {
  writeJson(context.response, 200, {
    id: context.completionId,
    object: "chat.completion",
    created: context.created,
    model: context.request.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  });
}

async function writeSse(
  context: ResponseContext,
  content: AsyncIterable<string>,
): Promise<void> {
  const { response } = context;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeSseData(context, {
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      },
    ],
  });

  for await (const chunk of content) {
    if (chunk) {
      writeSseData(context, {
        choices: [
          {
            index: 0,
            delta: { content: chunk },
            finish_reason: null,
          },
        ],
      });
    }
  }

  writeSseData(context, {
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

function writeSseData(
  context: ResponseContext,
  value: Record<string, unknown>,
): void {
  context.response.write(
    `data: ${JSON.stringify({
      id: context.completionId,
      object: "chat.completion.chunk",
      created: context.created,
      model: context.request.model,
      ...value,
    })}\n\n`,
  );
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.writableEnded) {
    return;
  }

  const status = error instanceof HttpError ? error.status : 500;
  const code =
    error instanceof HttpError ? error.code : "internal_server_error";
  const message =
    error instanceof Error ? error.message : "Internal server error";

  if (response.headersSent) {
    response.write(
      `data: ${JSON.stringify({
        error: { message, type: code, code },
      })}\n\n`,
    );
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }

  writeJson(response, status, {
    error: {
      message,
      type: code,
      code,
    },
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function firstHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function* toAsyncIterable(
  chunks: readonly string[],
): AsyncGenerator<string> {
  yield* chunks;
}

function listen(
  server: Server,
  port: number,
  hostname: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, hostname);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
