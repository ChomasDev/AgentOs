import type { CapabilityManifest } from "./capability-manifest.js";
import type { CapabilityResult } from "./capability-result.js";

export interface CapabilityExecutionContext {
  runId: string;
  callId: string;
  sessionId?: string;
  userId?: string;
  startedAt: Date;
  signal?: AbortSignal;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface Capability<TInput = unknown, TOutput = unknown> {
  readonly manifest: CapabilityManifest;
  /**
   * Optional startup hook for capabilities that need to prepare native
   * resources or request host permissions before the agent starts listening.
   */
  initialize?(): Promise<void>;
  execute(
    input: TInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<TOutput>>;
}


export type CapabilityType =
  | "action"
  | "agent"
  | "orchestrator"
  | "discovery"
  | "database"
  | "memory"
  | "ai"
  | "env"
  | "input"
  | "output";
