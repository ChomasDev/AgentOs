import type {
  InputMessage,
  OrchestrationDecision,
  Orchestrator,
  OrchestratorOptions,
  OutputInterface,
} from "@agent-os/core/domain";

export interface __CLASS_NAME__Options {}

export class __CLASS_NAME__ implements Orchestrator {
  constructor(private readonly options: __CLASS_NAME__Options = {}) {
    void this.options;
  }

  async orchestrate(
    message: InputMessage,
    outputs: readonly OutputInterface[],
    options: OrchestratorOptions = {},
  ): Promise<OrchestrationDecision> {
    // TODO: choose capabilities and an output for this message
    void options;

    const output =
      outputs.find((candidate) => candidate.channel === message.channel) ??
      outputs[0];

    if (!output) {
      throw new Error("__CLASS_NAME__ requires at least one output");
    }

    return {
      capabilityIds: [],
      outputChannel: output.channel,
    };
  }
}
