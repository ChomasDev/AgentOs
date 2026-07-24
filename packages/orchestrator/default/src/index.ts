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
  reason: string;
}

const defaultInstructions = [
  "You route one Agent OS message.",
  "Select only capabilities that can materially help answer or execute the message.",
  "Use an empty capabilityIds array when no tool is needed.",
  "Choose exactly one available output channel.",
  "Prefer the output matching the input channel or conversation unless the message or metadata clearly requests another destination.",
].join(" ");

export class DefaultOrchestrator implements Orchestrator {
  private readonly model: AIProvider;
  private readonly capabilityDiscovery: CapabilityDiscovery;
  private readonly maxCapabilities: number;
  private readonly instructions: string;

  constructor(options: DefaultOrchestratorOptions) {
    this.model = options.model;
    this.capabilityDiscovery = options.capabilityDiscovery;
    this.maxCapabilities = Math.max(0, options.maxCapabilities ?? 8);
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

      return {
        capabilityIds,
        outputChannel,
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
          description: "Exactly one available destination channel.",
        },
        reason: {
          type: "string",
          description: "A short operational explanation of the routing choice.",
        },
      },
      required: ["capabilityIds", "outputChannel", "reason"],
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

/** @deprecated Use DefaultOrchestrator. */
export { DefaultOrchestrator as ModelOrchestrator };
export type ModelOrchestratorOptions = DefaultOrchestratorOptions;
