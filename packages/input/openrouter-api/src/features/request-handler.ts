import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { InputListener, InputMessage } from "@agent-os/core/domain";
import { writeCompletion, writeSse } from "./completion-response.js";
import { renderConversation } from "./conversation.js";
import { HttpError } from "./http-error.js";
import { writeError, writeJson } from "./http-response.js";
import { safeLog } from "./logger.js";
import { applyCors, authorize } from "./request-policy.js";
import { parseChatCompletionRequest, readJsonBody } from "./request-parser.js";
import { ResponseCoordinator } from "./response-coordinator.js";
import type {
  ChatCompletionRequest,
  OpenRouterApiLogEvent,
  OpenRouterApiModel,
  ResolvedOpenRouterApiOptions,
  ResponseContext,
} from "./types.js";
import { firstHeader, normalizeText, toAsyncIterable } from "./utils.js";

const MODEL_PATHS = new Set(["/v1/models", "/api/v1/models"]);

export class RequestHandler {
  constructor(
    private readonly options: ResolvedOpenRouterApiOptions,
    private readonly models: readonly OpenRouterApiModel[],
    private readonly responses: ResponseCoordinator,
  ) {}

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
  ): Promise<void> {
    const startedAt = Date.now();
    const requestId = `req-${randomUUID()}`;
    const method = request.method ?? "UNKNOWN";
    const path = new URL(request.url ?? "/", "http://agent-os.local").pathname;

    response.setHeader("x-request-id", requestId);
    this.log({ type: "request.started", requestId, method, path });
    try {
      applyCors(request, response, this.options.corsOrigins);
      await this.route(request, response, listener, path);
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

  private async route(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
    path: string,
  ): Promise<void> {
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

    authorize(request, this.options.apiKey);
    if (request.method === "GET" && MODEL_PATHS.has(path)) {
      writeJson(response, 200, { object: "list", data: this.modelList() });
      return;
    }
    if (
      request.method !== "POST" ||
      !this.options.chatCompletionsPaths.includes(path)
    ) {
      throw new HttpError(404, "Not found", "not_found");
    }

    await this.completeChat(request, response, listener);
  }

  private async completeChat(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
  ): Promise<void> {
    const body = parseChatCompletionRequest(
      await readJsonBody(request, this.options.maxBodyBytes),
    );
    const completionId = `chatcmpl-${randomUUID()}`;
    const context = createResponseContext(body, response, completionId);
    const message = this.createMessage(request, body, completionId);
    response.setHeader("x-request-id", completionId);

    await this.responses.run(context, message, listener);
    if (context.responded || response.writableEnded) return;

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
      return;
    }
    writeCompletion(context, output.chunks.join(""));
  }

  private createMessage(
    request: IncomingMessage,
    body: ChatCompletionRequest,
    completionId: string,
  ): InputMessage {
    const sessionId =
      normalizeText(body.session_id) ??
      normalizeText(body.user) ??
      normalizeText(firstHeader(request, "x-session-id")) ??
      this.options.sessionId ??
      `openrouter-${randomUUID()}`;
    return {
      id: `input-${randomUUID()}`,
      channel: "openrouter-api",
      sessionId,
      text: renderConversation(body.messages),
      createdAt: new Date(),
      metadata: {
        preferredOutputChannel: "openrouter-api",
        requestId: completionId,
        transport: "openrouter-api",
        model: body.model,
        stream: body.stream === true,
        remoteAddress: request.socket.remoteAddress,
      },
    };
  }

  private modelList() {
    return this.models.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: "agent-os",
      name: model.name,
      description: model.description,
      context_length: model.contextLength,
    }));
  }

  private log(event: OpenRouterApiLogEvent): void {
    safeLog(this.options.onLog, event);
  }
}

function createResponseContext(
  request: ChatCompletionRequest,
  response: ServerResponse,
  completionId: string,
): ResponseContext {
  return {
    request,
    response,
    completionId,
    created: Math.floor(Date.now() / 1000),
    outputs: [],
    responded: false,
  };
}
