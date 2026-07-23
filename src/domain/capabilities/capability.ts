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
  execute(
    input: TInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<TOutput>>;
}
