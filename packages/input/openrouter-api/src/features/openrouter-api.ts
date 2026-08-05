import {
  createServer,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  InputInterface,
  InputListener,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";
import { defaultOpenRouterApiLog, safeLog } from "./logger.js";
import { RequestHandler } from "./request-handler.js";
import { ResponseCoordinator } from "./response-coordinator.js";
import { close, listen } from "./server-lifecycle.js";
import type {
  OpenRouterApiInputOptions,
  OpenRouterApiModel,
  ResolvedOpenRouterApiOptions,
} from "./types.js";

const DEFAULT_CHAT_PATHS = [
  "/v1/chat/completions",
  "/api/v1/chat/completions",
] as const;

/** OpenAI/OpenRouter-compatible HTTP input and output adapter. */
export class OpenRouterApiInput implements InputInterface, OutputInterface {
  readonly channel = "openrouter-api" as const;
  readonly description =
    "The OpenRouter-compatible HTTP request that originated this message";

  private readonly options: ResolvedOpenRouterApiOptions;
  private readonly requests: RequestHandler;
  private readonly responses = new ResponseCoordinator();
  private server?: Server;
  private listening = false;
  private stopped?: Promise<void>;
  private resolveStopped?: () => void;

  constructor(options: OpenRouterApiInputOptions = {}) {
    this.options = resolveOptions(options);
    this.requests = new RequestHandler(
      this.options,
      resolveModels(options.models),
      this.responses,
    );
  }

  get address(): AddressInfo | string | null {
    return this.server?.address() ?? null;
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("OpenRouterApiInput listener is already running");
    }

    this.prepareServer(listener);
    try {
      await listen(this.server!, this.options.port, this.options.hostname);
      this.logListening();
      await this.stopped;
    } catch (error) {
      this.listening = false;
      this.resolveStopped?.();
      throw error;
    } finally {
      this.resetServer();
    }
  }

  async stop(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    if (this.server?.listening) await close(this.server);
    safeLog(this.options.onLog, { type: "stopped" });
    this.resolveStopped?.();
  }

  write(content: OutputContent): Promise<void> {
    return this.responses.write(content);
  }

  private prepareServer(listener: InputListener): void {
    this.listening = true;
    this.stopped = new Promise<void>((resolveStopped) => {
      this.resolveStopped = resolveStopped;
    });
    this.server = createServer((request, response) => {
      void this.requests.handle(request, response, listener);
    });
    this.server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
  }

  private logListening(): void {
    const address = this.address;
    const port =
      typeof address === "object" && address
        ? address.port
        : this.options.port;
    safeLog(this.options.onLog, {
      type: "listening",
      url: `http://${this.options.hostname}:${port}`,
    });
  }

  private resetServer(): void {
    this.server = undefined;
    this.stopped = undefined;
    this.resolveStopped = undefined;
    this.listening = false;
  }
}

function resolveOptions(
  options: OpenRouterApiInputOptions,
): ResolvedOpenRouterApiOptions {
  return {
    ...options,
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 3000,
    maxBodyBytes: Math.max(1, options.maxBodyBytes ?? 1_048_576),
    chatCompletionsPaths: options.chatCompletionsPaths ?? DEFAULT_CHAT_PATHS,
    onLog:
      options.onLog ??
      (options.log === false ? undefined : defaultOpenRouterApiLog),
  };
}

function resolveModels(
  models: OpenRouterApiInputOptions["models"],
): readonly OpenRouterApiModel[] {
  return (models ?? ["agent-os"]).map((model) =>
    typeof model === "string" ? { id: model } : model,
  );
}
