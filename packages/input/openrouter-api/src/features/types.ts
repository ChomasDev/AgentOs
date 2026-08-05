import type { ServerResponse } from "node:http";

export interface OpenRouterApiModel {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
}

export type OpenRouterApiLogEvent =
  | { type: "listening"; url: string }
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
  | { type: "stopped" };

export interface OpenRouterApiInputOptions {
  hostname?: string;
  port?: number;
  apiKey?: string;
  sessionId?: string;
  models?: readonly (string | OpenRouterApiModel)[];
  corsOrigins?: "*" | readonly string[] | false;
  maxBodyBytes?: number;
  chatCompletionsPaths?: readonly string[];
  /** Logs lifecycle events by default unless `onLog` is provided. */
  log?: boolean;
  onLog?: (event: OpenRouterApiLogEvent) => void;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  user?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface BufferedOutput {
  chunks: string[];
}

export interface ResponseContext {
  request: ChatCompletionRequest;
  response: ServerResponse;
  completionId: string;
  created: number;
  outputs: BufferedOutput[];
  responded: boolean;
}

export interface ResolvedOpenRouterApiOptions
  extends Omit<
    OpenRouterApiInputOptions,
    "hostname" | "port" | "maxBodyBytes" | "chatCompletionsPaths" | "models"
  > {
  hostname: string;
  port: number;
  maxBodyBytes: number;
  chatCompletionsPaths: readonly string[];
}
