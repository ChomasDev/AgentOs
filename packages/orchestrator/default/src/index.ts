import type {
  AIFunctionDefinition,
  AIProvider,
  CapabilityDiscovery,
  CapabilityManifest,
  InputMessage,
  OrchestrationDecision,
  Orchestrator,
  OrchestratorOptions,
  OutputInterface,
} from "@agent-os/core/domain";

export interface DefaultOrchestratorOptions {
  model: AIProvider;
  capabilityDiscovery: CapabilityDiscovery;
  maxCapabilities?: number;
  instructions?: string;
}

interface ModelDecision {
  capabilityIds: string[];
  outputChannel: string;
  additionalOutputs: ModelAdditionalOutput[];
  reason: string;
}

interface ModelAdditionalOutput {
  outputChannel: string;
  content: "response" | "text";
  text: string;
}

const defaultInstructions = [
  "You route one Agent OS message.",
  "Consider the complete capability catalog, including capabilities whose names or tags do not obviously match the user's wording.",
  "Select only capabilities that can materially help answer or execute the message.",
  "Use an empty capabilityIds array when no tool is needed.",
  "Choose one primary output channel for the generated response.",
  "Use additionalOutputs only when the user requests or clearly implies delivery to multiple destinations.",
  "An additional output with content=response receives a copy of the generated response.",
  "An additional output with content=text receives its exact text; use this for a short acknowledgement such as 'Okay, done.' on the originating channel when the substantive response is delivered elsewhere.",
  "When a request from a web/API channel asks to write or prepare a message and a configured messaging channel such as Telegram is available, deliver the substantive response to that messaging channel and acknowledge completion on the originating channel.",
  "Otherwise prefer the output matching the input channel or conversation unless the message or metadata clearly requests another destination.",
].join(" ");

export class DefaultOrchestrator implements Orchestrator {
  private readonly model: AIProvider;
  private readonly capabilityDiscovery: CapabilityDiscovery;
  private readonly maxCapabilities: number;
  private readonly instructions: string;

  constructor(options: DefaultOrchestratorOptions) {
    this.model = options.model;
    this.capabilityDiscovery = options.capabilityDiscovery;
    this.maxCapabilities = Math.max(0, options.maxCapabilities ?? 50);
    this.instructions = options.instructions ?? defaultInstructions;
  }

  async orchestrate(
    message: InputMessage,
    outputs: readonly OutputInterface[],
    options: OrchestratorOptions = {},
  ): Promise<OrchestrationDecision> {
    if (outputs.length === 0) {
      throw new Error("DefaultOrchestrator requires at least one output");
    }

    const candidates = await this.capabilityDiscovery.discover();
    const channels = unique(outputs.map((output) => output.channel));
    const fallbackOutput = selectFallbackOutput(message, outputs);

    try {
      const result = await this.model.functionCall<ModelDecision>(
        createRoutingPrompt(message, candidates, outputs),
        createDecisionFunction(candidates, channels, this.maxCapabilities),
        {
          signal: options.signal,
          instructions: this.instructions,
        },
      );

      const allowedCapabilityIds = new Set(
        candidates.map((candidate) => candidate.id),
      );
      const capabilityIds = unique(result.arguments.capabilityIds)
        .filter((id) => allowedCapabilityIds.has(id))
        .slice(0, this.maxCapabilities);
      const outputChannel = channels.includes(
        result.arguments.outputChannel,
      )
        ? result.arguments.outputChannel
        : fallbackOutput.channel;
      const additionalOutputs = sanitizeAdditionalOutputs(
        result.arguments.additionalOutputs,
        channels,
        outputChannel,
      );

      return {
        capabilityIds,
        outputChannel,
        additionalOutputs,
        reason: result.arguments.reason,
      };
    } catch (error) {
      const fallbackCapabilities = await this.capabilityDiscovery.discover({
        text: message.text,
        limit: this.maxCapabilities,
      });

      return {
        capabilityIds: fallbackCapabilities.map(
          (capability) => capability.id,
        ),
        outputChannel: fallbackOutput.channel,
        additionalOutputs: [],
        reason: `Model routing failed; used deterministic fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

function createDecisionFunction(
  capabilities: readonly CapabilityManifest[],
  channels: readonly string[],
  maxCapabilities: number,
): AIFunctionDefinition<ModelDecision> {
  return {
    name: "route_agent_message",
    description:
      "Selects the capability IDs and output channel for an Agent OS message.",
    strict: true,
    inputSchema: {
      type: "object",
      properties: {
        capabilityIds: {
          type: "array",
          items:
            capabilities.length > 0
              ? {
                  type: "string",
                  enum: capabilities.map((capability) => capability.id),
                }
              : { type: "string" },
          maxItems: maxCapabilities,
          description:
            "Only the IDs of capabilities needed for this message.",
        },
        outputChannel: {
          type: "string",
          enum: channels,
          description:
            "Primary destination for progress and the generated response.",
        },
        additionalOutputs: {
          type: "array",
          maxItems: Math.max(0, channels.length - 1),
          description:
            "Optional extra response copies or fixed channel-specific messages.",
          items: {
            type: "object",
            properties: {
              outputChannel: {
                type: "string",
                enum: channels,
              },
              content: {
                type: "string",
                enum: ["response", "text"],
              },
              text: {
                type: "string",
                description:
                  "Exact message for content=text; use an empty string for content=response.",
              },
            },
            required: ["outputChannel", "content", "text"],
            additionalProperties: false,
          },
        },
        reason: {
          type: "string",
          description: "A short operational explanation of the routing choice.",
        },
      },
      required: [
        "capabilityIds",
        "outputChannel",
        "additionalOutputs",
        "reason",
      ],
      additionalProperties: false,
    },
  };
}

function createRoutingPrompt(
  message: InputMessage,
  capabilities: readonly CapabilityManifest[],
  outputs: readonly OutputInterface[],
): string {
  return JSON.stringify(
    {
      message: {
        channel: message.channel,
        sessionId: message.sessionId,
        text: message.text,
        metadata: message.metadata ?? {},
      },
      availableCapabilities: capabilities.map((capability) => ({
        id: capability.id,
        name: capability.name,
        description: capability.description,
        tags: capability.tags ?? [],
      })),
      availableOutputs: outputs.map((output) => ({
        channel: output.channel,
        description:
          output.description ?? `Send the response to ${output.channel}`,
      })),
    },
    null,
    2,
  );
}

function selectFallbackOutput(
  message: InputMessage,
  outputs: readonly OutputInterface[],
): OutputInterface {
  const preferredOutput = message.metadata?.preferredOutputChannel;

  if (typeof preferredOutput === "string") {
    const preferred = outputs.find(
      (output) => output.channel === preferredOutput,
    );

    if (preferred) {
      return preferred;
    }
  }

  return (
    outputs.find((output) => output.channel === message.channel) ??
    outputs[0]!
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sanitizeAdditionalOutputs(
  outputs: readonly ModelAdditionalOutput[] | undefined,
  channels: readonly string[],
  primaryChannel: string,
): ModelAdditionalOutput[] {
  const availableChannels = new Set(channels);
  const seenChannels = new Set([primaryChannel]);
  const sanitized: ModelAdditionalOutput[] = [];

  for (const output of outputs ?? []) {
    if (
      !availableChannels.has(output.outputChannel) ||
      seenChannels.has(output.outputChannel) ||
      (output.content === "text" && output.text.trim() === "")
    ) {
      continue;
    }

    seenChannels.add(output.outputChannel);
    sanitized.push({
      outputChannel: output.outputChannel,
      content: output.content,
      text: output.content === "text" ? output.text : "",
    });
  }

  return sanitized;
}

/** @deprecated Use DefaultOrchestrator. */
export { DefaultOrchestrator as ModelOrchestrator };
export type ModelOrchestratorOptions = DefaultOrchestratorOptions;
