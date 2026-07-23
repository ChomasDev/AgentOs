import type { AgentLoopEventHandler } from "../agent/agent-loop.js";
import type { InputMessage } from "../input/input-interface.js";
import type {
  OutputChannel,
  OutputInterface,
} from "../output/output-interface.js";

export interface OrchestrationDecision {
  capabilityIds: readonly string[];
  outputChannel: OutputChannel;
  reason?: string;
}

export interface OrchestratorOptions {
  signal?: AbortSignal;
  onEvent?: AgentLoopEventHandler;
}

/**
 * Discovers and selects the capabilities and output destination for one input message.
 * Implementations may use a model, deterministic rules, or both.
 * The agent loop does not rediscover — it only executes the selected capability IDs.
 */
export interface Orchestrator {
  orchestrate(
    message: InputMessage,
    outputs: readonly OutputInterface[],
    options?: OrchestratorOptions,
  ): Promise<OrchestrationDecision>;
}
