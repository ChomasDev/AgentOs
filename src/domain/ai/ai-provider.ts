import type { JsonSchema } from "../capabilities/capability-manifest.js";

export type AIProviderName = "openai" | (string & {});

export interface AIModelSettings {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface AIProcessOptions {
  stream?: boolean;
  instructions?: string;
  settings?: AIModelSettings;
  signal?: AbortSignal;
}

export type AIProcessResult =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "stream";
      stream: AsyncIterable<string>;
    };

export interface AIFunctionDefinition<TArguments = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  strict?: boolean;
}

export interface AIFunctionCallResult<TArguments = unknown> {
  type: "function-call";
  name: string;
  callId: string;
  arguments: TArguments;
}

/** Provider-neutral model contract implemented by provider packages. */
export interface AIProvider {
  readonly provider: AIProviderName;
  readonly model: string;
  readonly settings: Readonly<AIModelSettings>;

  processInput(
    input: string,
    options?: AIProcessOptions,
  ): Promise<AIProcessResult>;

  functionCall<TArguments>(
    input: string,
    definition: AIFunctionDefinition<TArguments>,
    options?: Omit<AIProcessOptions, "stream">,
  ): Promise<AIFunctionCallResult<TArguments>>;
}
