import type {
  CapabilityCall,
  CapabilityCallOutcome,
} from "./capability-call.js";

export type AgentRunStatus =
  | "running"
  | "waiting-for-capability"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRun {
  id: string;
  sessionId: string;
  goal: string;
  status: AgentRunStatus;
  calls: readonly CapabilityCall[];
  outcomes: readonly CapabilityCallOutcome[];
  startedAt: Date;
  completedAt?: Date;
  error?: {
    code: string;
    message: string;
  };
  metadata?: Readonly<Record<string, unknown>>;
}
