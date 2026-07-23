import type { AIProcessResult } from "../ai/ai-provider.js";
import type { InputMessage } from "../input/input-interface.js";

interface AgentLoopEventBase {
  runId: string;
  at: Date;
}

export type AgentLoopEvent =
  | (AgentLoopEventBase & {
      type: "discovery.started";
      query: string;
    })
  | (AgentLoopEventBase & {
      type: "discovery.completed";
      capabilities: readonly string[];
    })
  | (AgentLoopEventBase & {
      type: "model.started";
      capabilities: readonly string[];
    })
  | (AgentLoopEventBase & {
      type: "capability.started";
      callId: string;
      capability: string;
      arguments: unknown;
    })
  | (AgentLoopEventBase & {
      type: "capability.completed";
      callId: string;
      capability: string;
      result: unknown;
    })
  | (AgentLoopEventBase & {
      type: "capability.failed";
      callId: string;
      capability: string;
      error: string;
    });

export type AgentLoopEventHandler = (
  event: AgentLoopEvent,
) => void | Promise<void>;

export interface AgentLoopOptions {
  /**
   * Capability IDs selected by the orchestrator.
   * Empty means run without tools.
   */
  capabilityIds: readonly string[];
  stream: boolean;
  signal?: AbortSignal;
  onEvent?: AgentLoopEventHandler;
}

export interface AgentLoop {
  run(
    message: InputMessage,
    options: AgentLoopOptions,
  ): Promise<AIProcessResult>;
}
