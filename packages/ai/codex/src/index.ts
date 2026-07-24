import { randomUUID } from "node:crypto";
import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type ModelReasoningEffort,
  type SandboxMode,
  type Thread,
  type ThreadEvent,
  type WebSearchMode,
} from "@openai/codex-sdk";
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

export interface CodexProviderOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  settings?: AIModelSettings;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  codexPathOverride?: string;
  config?: CodexOptions["config"];
}

interface FunctionStep {
  type: "text" | "function-call";
  name: string;
  arguments: unknown;
  text: string | null;
}

const providerInstructions = [
  "You are the model inside Agent OS.",
  "Do not inspect or modify the workspace and do not use Codex built-in tools.",
  "Use only the information in the request and the Agent OS capabilities explicitly described in it.",
].join(" ");

export class CodexProvider implements AIProvider {
  readonly provider = "codex" as const;
  readonly model: string;
  readonly settings: Readonly<AIModelSettings>;

  private readonly codex: Codex;
  private readonly threadOptions: Parameters<Codex["startThread"]>[0];

  constructor(options: CodexProviderOptions) {
    const model = options.model.trim();

    if (!model) {
      throw new Error("CodexProvider model is required");
    }

    this.model = model;
    this.settings = Object.freeze({ ...options.settings });
    this.codex = new Codex({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      codexPathOverride: options.codexPathOverride,
      config: options.config,
    });
    this.threadOptions = {
      model,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      skipGitRepoCheck: options.skipGitRepoCheck,
      sandboxMode: options.sandboxMode ?? "read-only",
      approvalPolicy: options.approvalPolicy ?? "never",
      modelReasoningEffort: options.modelReasoningEffort,
      networkAccessEnabled: options.networkAccessEnabled ?? false,
      webSearchMode: options.webSearchMode ?? "disabled",
    };
  }

  async processInput(
    input: string,
    options: AIProcessOptions = {},
  ): Promise<AIProcessResult> {
    const prompt = createPrompt(input, options.instructions);
    const thread = this.startThread();

    if (options.stream) {
      return {
        type: "stream",
        stream: streamAgentText(
          thread,
          prompt,
          resolveSignal(this.settings, options),
        ),
      };
    }

    const result = await thread.run(prompt, {
      signal: resolveSignal(this.settings, options),
    });
    return { type: "text", text: result.finalResponse };
  }

  async functionCall<TArguments>(
    input: string,
    definition: AIFunctionDefinition<TArguments>,
    options: Omit<AIProcessOptions, "stream"> = {},
  ): Promise<AIFunctionCallResult<TArguments>> {
    validateDefinition(definition);
    const prompt = createPrompt(
      input,
      options.instructions,
      [
        `Return the arguments for the required "${definition.name}" function.`,
        `Function description: ${definition.description}`,
        "Return only the JSON object matching the supplied output schema.",
      ].join("\n"),
    );
    const result = await this.startThread().run(prompt, {
      outputSchema: definition.inputSchema,
      signal: resolveSignal(this.settings, options),
    });

    return {
      type: "function-call",
      name: definition.name,
      callId: `codex-${randomUUID()}`,
      arguments: parseJson<TArguments>(
        result.finalResponse,
        `function "${definition.name}" arguments`,
      ),
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

    validateDefinitions(definitions);
    const stream = this.runFunctionLoop(input, definitions, options);

    if (options.stream) {
      return { type: "stream", stream };
    }

    let text = "";
    for await (const chunk of stream) {
      text += chunk;
    }

    return { type: "text", text };
  }

  private startThread(): Thread {
    return this.codex.startThread(this.threadOptions);
  }

  private async *runFunctionLoop(
    input: string,
    definitions: readonly AIExecutableFunctionDefinition[],
    options: AIFunctionProcessOptions,
  ): AsyncGenerator<string> {
    const thread = this.startThread();
    const schema = createFunctionStepSchema(definitions);
    const maxSteps = Math.max(1, options.maxSteps ?? 5);
    let prompt = createPrompt(
      input,
      options.instructions,
      createFunctionInstructions(definitions),
    );

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      const result = await thread.run(prompt, {
        outputSchema: schema,
        signal: resolveSignal(this.settings, options),
      });
      const step = parseFunctionStep(result.finalResponse);

      if (step.type === "text") {
        if (typeof step.text !== "string") {
          throw new Error("Codex returned a final step without text");
        }

        yield step.text;
        return;
      }

      const definition = definitions.find(
        (candidate) => candidate.name === step.name,
      );

      if (!definition) {
        throw new Error(`Codex requested unknown function "${step.name}"`);
      }

      const callId = `codex-${randomUUID()}`;
      const output = await definition.execute(step.arguments, {
        callId,
        signal: options.signal,
      });
      prompt = [
        `Agent OS executed "${definition.name}".`,
        "Capability result:",
        serialize(output),
        "Continue the original request. Call another capability if needed, otherwise return the final answer.",
      ].join("\n\n");
    }

    throw new Error(`Codex exceeded the ${maxSteps}-step function-call limit`);
  }
}

export { CodexProvider as AICodexProvider };

function createPrompt(
  input: string,
  instructions?: string,
  taskInstructions?: string,
): string {
  const normalized = input.trim();

  if (!normalized) {
    throw new Error("AI input is required");
  }

  return [
    providerInstructions,
    instructions?.trim(),
    taskInstructions?.trim(),
    "Request:",
    normalized,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function createFunctionInstructions(
  definitions: readonly AIExecutableFunctionDefinition[],
): string {
  return [
    "Choose whether to call one Agent OS capability or return the final answer.",
    "For a function call, set type to function-call, provide its exact name and arguments, and set text to null.",
    "For a final answer, set type to text, name to an empty string, arguments to null, and provide text.",
    "Available Agent OS capabilities:",
    serialize(
      definitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
      })),
    ),
  ].join("\n");
}

function createFunctionStepSchema(
  definitions: readonly AIExecutableFunctionDefinition[],
) {
  return {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["text", "function-call"],
      },
      name: {
        type: "string",
        enum: ["", ...definitions.map((definition) => definition.name)],
      },
      arguments: {
        anyOf: [
          { type: "null" },
          ...definitions.map((definition) => definition.inputSchema),
        ],
      },
      text: {
        type: ["string", "null"],
      },
    },
    required: ["type", "name", "arguments", "text"],
    additionalProperties: false,
  } as const;
}

function parseFunctionStep(value: string): FunctionStep {
  const parsed = parseJson<Record<string, unknown>>(value, "function step");

  if (
    (parsed.type !== "text" && parsed.type !== "function-call") ||
    typeof parsed.name !== "string" ||
    (parsed.text !== null && typeof parsed.text !== "string")
  ) {
    throw new Error("Codex returned an invalid function step");
  }

  return {
    type: parsed.type,
    name: parsed.name,
    arguments: parsed.arguments,
    text: parsed.text,
  };
}

function validateDefinitions(
  definitions: readonly AIFunctionDefinition[],
): void {
  const names = new Set<string>();

  for (const definition of definitions) {
    validateDefinition(definition);

    if (names.has(definition.name)) {
      throw new Error(`Duplicate AI function name: "${definition.name}"`);
    }

    names.add(definition.name);
  }
}

function validateDefinition(definition: AIFunctionDefinition): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) {
    throw new Error(`Invalid AI function name: "${definition.name}"`);
  }
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Codex returned invalid JSON for ${label}`, {
      cause: error,
    });
  }
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function resolveSignal(
  defaults: Readonly<AIModelSettings>,
  options: Pick<AIProcessOptions, "settings" | "signal">,
): AbortSignal | undefined {
  const timeoutMs = options.settings?.timeoutMs ?? defaults.timeoutMs;
  const timeoutSignal =
    timeoutMs === undefined
      ? undefined
      : AbortSignal.timeout(Math.max(1, timeoutMs));

  if (options.signal && timeoutSignal) {
    return AbortSignal.any([options.signal, timeoutSignal]);
  }

  return options.signal ?? timeoutSignal;
}

async function* streamAgentText(
  thread: Thread,
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const { events } = await thread.runStreamed(prompt, { signal });
  const previousText = new Map<string, string>();

  for await (const event of events) {
    throwForFailedEvent(event);

    if (
      (event.type === "item.updated" ||
        event.type === "item.completed") &&
      event.item.type === "agent_message"
    ) {
      const previous = previousText.get(event.item.id) ?? "";
      const chunk = event.item.text.startsWith(previous)
        ? event.item.text.slice(previous.length)
        : event.item.text;

      previousText.set(event.item.id, event.item.text);
      if (chunk) {
        yield chunk;
      }
    }
  }
}

function throwForFailedEvent(event: ThreadEvent): void {
  if (event.type === "turn.failed") {
    throw new Error(event.error.message);
  }

  if (event.type === "error") {
    throw new Error(event.message);
  }
}
