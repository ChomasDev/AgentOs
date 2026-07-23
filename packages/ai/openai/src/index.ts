import {
  createOpenAI,
  type OpenAIProviderSettings,
} from "@ai-sdk/openai";
import {
  generateText,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
} from "ai";
import type {
  AIFunctionCallResult,
  AIFunctionDefinition,
  AIFunctionProcessOptions,
  AIExecutableFunctionDefinition,
  AIModelSettings,
  AIProcessOptions,
  AIProcessResult,
  AIProvider,
  Environment,
} from "@agent-os/core/domain";

export interface OpenAIProviderOptions {
  model: string;
  env: Environment;
  settings?: AIModelSettings;
  baseURL?: string;
  organization?: string;
  project?: string;
  headers?: Record<string, string>;
  fetch?: OpenAIProviderSettings["fetch"];
}

export class OpenAIProvider implements AIProvider {
  readonly provider = "openai" as const;
  readonly model: string;
  readonly settings: Readonly<AIModelSettings>;

  private readonly languageModel: ReturnType<
    ReturnType<typeof createOpenAI>
  >;

  constructor(options: OpenAIProviderOptions) {
    const model = options.model.trim();

    if (!model) {
      throw new Error("OpenAI model is required");
    }

    this.model = model;
    this.settings = Object.freeze({ ...options.settings });
    const apiKey = options.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAIProvider");
    }

    this.languageModel = createOpenAI({
      apiKey,
      baseURL: options.baseURL,
      organization: options.organization,
      project: options.project,
      headers: options.headers,
      fetch: options.fetch,
    })(model);
  }

  async processInput(
    input: string,
    options: AIProcessOptions = {},
  ): Promise<AIProcessResult> {
    const request = {
      model: this.languageModel,
      prompt: validateInput(input),
      instructions: options.instructions,
      ...toCallSettings(resolveSettings(this.settings, options.settings)),
      abortSignal: options.signal,
    };

    if (options.stream) {
      return {
        type: "stream",
        stream: streamText(request).textStream,
      };
    }

    const result = await generateText(request);
    return { type: "text", text: result.text };
  }

  async functionCall<TArguments>(
    input: string,
    definition: AIFunctionDefinition<TArguments>,
    options: Omit<AIProcessOptions, "stream"> = {},
  ): Promise<AIFunctionCallResult<TArguments>> {
    if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) {
      throw new Error(`Invalid AI function name: "${definition.name}"`);
    }

    const tools = {
      [definition.name]: tool({
        description: definition.description,
        inputSchema: jsonSchema<TArguments>(
          definition.inputSchema as Parameters<typeof jsonSchema>[0],
        ),
        strict: definition.strict ?? true,
      }),
    };

    const result = await generateText({
      model: this.languageModel,
      prompt: validateInput(input),
      instructions: options.instructions,
      ...toCallSettings(resolveSettings(this.settings, options.settings)),
      abortSignal: options.signal,
      tools,
      toolChoice: {
        type: "tool",
        toolName: definition.name,
      },
    });

    const call = result.toolCalls.find(
      (item) => item.toolName === definition.name,
    );

    if (!call) {
      throw new Error(
        `Model did not call the required function "${definition.name}"`,
      );
    }

    return {
      type: "function-call",
      name: definition.name,
      callId: call.toolCallId,
      arguments: call.input as TArguments,
    };
  }

  async processWithFunctions(
    input: string,
    definitions: readonly AIExecutableFunctionDefinition[],
    options: AIFunctionProcessOptions = {},
  ): Promise<AIProcessResult> {
    if (definitions.length === 0) {
      return this.processInput(input, options);
    }

    const request = {
      model: this.languageModel,
      prompt: validateInput(input),
      instructions: options.instructions,
      ...toCallSettings(resolveSettings(this.settings, options.settings)),
      abortSignal: options.signal,
      tools: createExecutableTools(definitions),
      stopWhen: stepCountIs(Math.max(1, options.maxSteps ?? 5)),
    };

    if (options.stream) {
      return {
        type: "stream",
        stream: streamText(request).textStream,
      };
    }

    const result = await generateText(request);
    return { type: "text", text: result.text };
  }
}

export { OpenAIProvider as AIOpenAIProvider };

function validateInput(input: string): string {
  const normalized = input.trim();

  if (!normalized) {
    throw new Error("AI input is required");
  }

  return normalized;
}

function resolveSettings(
  defaults: Readonly<AIModelSettings>,
  overrides?: AIModelSettings,
): AIModelSettings {
  return { ...defaults, ...overrides };
}

function toCallSettings(settings: AIModelSettings) {
  return {
    ...(settings.maxOutputTokens !== undefined
      ? { maxOutputTokens: settings.maxOutputTokens }
      : {}),
    ...(settings.temperature !== undefined
      ? { temperature: settings.temperature }
      : {}),
    ...(settings.topP !== undefined ? { topP: settings.topP } : {}),
    ...(settings.maxRetries !== undefined
      ? { maxRetries: settings.maxRetries }
      : {}),
    ...(settings.timeoutMs !== undefined
      ? { timeout: settings.timeoutMs }
      : {}),
  };
}

function createExecutableTools(
  definitions: readonly AIExecutableFunctionDefinition[],
): ToolSet {
  const tools: ToolSet = {};

  for (const definition of definitions) {
    if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) {
      throw new Error(`Invalid AI function name: "${definition.name}"`);
    }

    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(
        definition.inputSchema as Parameters<typeof jsonSchema>[0],
      ),
      strict: definition.strict ?? true,
      execute: (arguments_, context) =>
        definition.execute(arguments_, {
          callId: context.toolCallId,
          signal: context.abortSignal,
        }),
    });
  }

  return tools;
}
