import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type ModelReasoningEffort,
  type SandboxMode,
  type Thread,
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
  JsonSchema,
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

interface CodexAppServerOptions {
  apiKey?: string;
  baseUrl?: string;
  codexPathOverride?: string;
  config?: CodexOptions["config"];
  model: string;
  workingDirectory: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalMode;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
}

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    message?: string;
  };
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
  private readonly appServerOptions: CodexAppServerOptions;

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
    this.appServerOptions = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      codexPathOverride: options.codexPathOverride,
      config: options.config,
      model,
      workingDirectory: options.workingDirectory ?? process.cwd(),
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
        stream: streamAppServerText(
          prompt,
          this.appServerOptions,
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
      outputSchema: normalizeCodexOutputSchema(definition.inputSchema),
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
          ...definitions.map((definition) =>
            normalizeCodexOutputSchema(definition.inputSchema),
          ),
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

/**
 * Codex structured outputs use OpenAI's strict schema subset. Every object
 * property must be listed in `required`; optional fields are represented as
 * required nullable fields instead.
 */
export function normalizeCodexOutputSchema(schema: JsonSchema): JsonSchema {
  return normalizeSchemaNode(schema) as JsonSchema;
}

function normalizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaNode);
  }
  if (!isRecord(value)) {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      normalizeSchemaNode(entry),
    ]),
  );
  if (!isRecord(value.properties)) {
    return normalized;
  }

  const originallyRequired = new Set(
    Array.isArray(value.required)
      ? value.required.filter(
        (entry): entry is string => typeof entry === "string",
      )
      : [],
  );
  const properties = Object.fromEntries(
    Object.entries(value.properties).map(([key, propertySchema]) => {
      const property = normalizeSchemaNode(propertySchema);
      return [
        key,
        originallyRequired.has(key) || allowsNull(property)
          ? property
          : { anyOf: [property, { type: "null" }] },
      ];
    }),
  );

  return {
    ...normalized,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function allowsNull(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "null") {
    return true;
  }
  if (Array.isArray(value.type) && value.type.includes("null")) {
    return true;
  }
  if (Array.isArray(value.enum) && value.enum.includes(null)) {
    return true;
  }
  return ["anyOf", "oneOf"].some(
    (key) => Array.isArray(value[key]) && value[key].some(allowsNull),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function* streamAppServerText(
  prompt: string,
  options: CodexAppServerOptions,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  signal?.throwIfAborted();

  const invocation = resolveAppServerInvocation(
    options.codexPathOverride,
  );
  const environment = { ...process.env };
  if (options.apiKey) {
    environment.CODEX_API_KEY = options.apiKey;
  }

  const child = spawn(invocation.command, invocation.arguments, {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  let childError: Error | undefined;
  let stderr = "";
  let threadId: string | undefined;
  let turnId: string | undefined;
  const streamedItemIds = new Set<string>();

  child.once("error", (error) => {
    childError = error;
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (stderr.length < 16_384) {
      stderr += String(chunk).slice(0, 16_384 - stderr.length);
    }
  });

  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("exit", (code, exitSignal) => {
      resolve({ code, signal: exitSignal });
    });
  });
  const abort = () => child.kill();
  signal?.addEventListener("abort", abort, { once: true });

  const send = (message: unknown) => {
    if (!child.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable");
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  try {
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "agent_os",
          title: "Agent OS",
          version: "0.1.0",
        },
      },
    });

    for await (const line of lines) {
      signal?.throwIfAborted();
      const message = parseRpcMessage(line);

      if (message.error) {
        throw new Error(
          message.error.message ?? "Codex app-server request failed",
        );
      }

      if (message.id === 1) {
        send({ method: "initialized", params: {} });
        send({
          method: "thread/start",
          id: 2,
          params: {
            model: options.model,
            cwd: options.workingDirectory,
            approvalPolicy: options.approvalPolicy,
            sandbox: options.sandboxMode,
            ephemeral: true,
            config: {
              ...options.config,
              openai_base_url: options.baseUrl,
              model_reasoning_effort: options.modelReasoningEffort,
              web_search: options.webSearchMode,
              sandbox_workspace_write: {
                network_access: options.networkAccessEnabled,
              },
            },
          },
        });
        continue;
      }

      if (message.id === 2) {
        threadId = readNestedString(message.result, "thread", "id");
        if (!threadId) {
          throw new Error(
            "Codex app-server did not return a thread id",
          );
        }

        send({
          method: "turn/start",
          id: 3,
          params: {
            threadId,
            input: [{ type: "text", text: prompt }],
          },
        });
        continue;
      }

      if (message.id === 3) {
        turnId = readNestedString(message.result, "turn", "id");
        continue;
      }

      if (message.method === "item/agentMessage/delta") {
        const params = asRecord(message.params);
        const delta = readString(params, "delta");
        const itemId = readString(params, "itemId");

        if (delta) {
          if (itemId) {
            streamedItemIds.add(itemId);
          }
          yield delta;
        }
        continue;
      }

      if (message.method === "item/completed") {
        const params = asRecord(message.params);
        const item = asRecord(params?.item);
        const itemId = readString(item, "id");

        if (
          readString(item, "type") === "agentMessage" &&
          (!itemId || !streamedItemIds.has(itemId))
        ) {
          const text = readString(item, "text");
          if (text) {
            yield text;
          }
        }
        continue;
      }

      if (message.method === "error") {
        const params = asRecord(message.params);
        if (params?.willRetry !== true) {
          throw new Error(
            readNestedString(params, "error", "message") ??
              "Codex turn failed",
          );
        }
        continue;
      }

      if (message.method === "turn/completed") {
        const params = asRecord(message.params);
        const completedThreadId = readString(params, "threadId");
        const turn = asRecord(params?.turn);
        const completedTurnId = readString(turn, "id");

        if (
          (threadId && completedThreadId !== threadId) ||
          (turnId && completedTurnId !== turnId)
        ) {
          continue;
        }

        const status = readString(turn, "status");
        if (status !== "completed") {
          throw new Error(
            readNestedString(turn, "error", "message") ??
              `Codex turn ended with status "${status ?? "unknown"}"`,
          );
        }
        return;
      }
    }

    if (childError) {
      throw childError;
    }

    const exit = await exited;
    const detail = exit.signal
      ? `signal ${exit.signal}`
      : `code ${exit.code ?? 1}`;
    throw new Error(
      `Codex app-server exited with ${detail}${
        stderr.trim() ? `: ${stderr.trim()}` : ""
      }`,
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    lines.close();
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}

function resolveAppServerInvocation(
  codexPathOverride?: string,
): { command: string; arguments: string[] } {
  if (codexPathOverride) {
    return {
      command: codexPathOverride,
      arguments: ["app-server", "--listen", "stdio://"],
    };
  }

  const sdkEntry = fileURLToPath(
    import.meta.resolve("@openai/codex-sdk"),
  );
  const sdkRequire = createRequire(sdkEntry);
  const codexCli = sdkRequire.resolve("@openai/codex/bin/codex.js");

  return {
    command: process.execPath,
    arguments: [
      codexCli,
      "app-server",
      "--listen",
      "stdio://",
    ],
  };
}

function parseRpcMessage(line: string): RpcMessage {
  try {
    const value = JSON.parse(line) as unknown;
    if (!asRecord(value)) {
      throw new Error("message is not an object");
    }
    return value as RpcMessage;
  } catch (error) {
    throw new Error("Codex app-server returned invalid JSON", {
      cause: error,
    });
  }
}

function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readNestedString(
  value: unknown,
  parent: string,
  child: string,
): string | undefined {
  return readString(asRecord(asRecord(value)?.[parent]), child);
}
