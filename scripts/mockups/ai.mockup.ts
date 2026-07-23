import type {
  AIExecutableFunctionDefinition,
  AIFunctionCallResult,
  AIFunctionDefinition,
  AIFunctionProcessOptions,
  AIModelSettings,
  AIProcessOptions,
  AIProcessResult,
  AIProvider,
} from "@agent-os/core/domain";

export interface __CLASS_NAME__Options {
  model: string;
  apiKey?: string;
  settings?: AIModelSettings;
}

export class __CLASS_NAME__ implements AIProvider {
  readonly provider = "__NAME__" as const;
  readonly model: string;
  readonly settings: Readonly<AIModelSettings>;

  constructor(options: __CLASS_NAME__Options) {
    const model = options.model.trim();
    if (!model) {
      throw new Error("__CLASS_NAME__ model is required");
    }

    this.model = model;
    this.settings = Object.freeze({ ...options.settings });
  }

  async processInput(
    input: string,
    options: AIProcessOptions = {},
  ): Promise<AIProcessResult> {
    // TODO: call your model provider
    void options;
    return { type: "text", text: input };
  }

  async functionCall<TArguments>(
    input: string,
    definition: AIFunctionDefinition<TArguments>,
    options: Omit<AIProcessOptions, "stream"> = {},
  ): Promise<AIFunctionCallResult<TArguments>> {
    // TODO: implement single forced function call
    void input;
    void definition;
    void options;
    throw new Error("__CLASS_NAME__.functionCall is not implemented");
  }

  async processWithFunctions(
    input: string,
    definitions: readonly AIExecutableFunctionDefinition[],
    options: AIFunctionProcessOptions = {},
  ): Promise<AIProcessResult> {
    // TODO: implement multi-step tool calling
    void definitions;
    void options;
    return { type: "text", text: input };
  }
}
