import type { CapabilityCall, CapabilityCallOutcome } from "./capability-call.js";
import type { AgentRunStatus } from "./agent-run.js";

interface ExecutionEventBase {
  id: string;
  runId: string;
  at: Date;
}

export interface RunStartedEvent extends ExecutionEventBase {
  type: "run.started";
  goal: string;
}

export interface CapabilityCalledEvent extends ExecutionEventBase {
  type: "capability.called";
  call: CapabilityCall;
}

export interface CapabilityCompletedEvent extends ExecutionEventBase {
  type: "capability.completed";
  outcome: CapabilityCallOutcome;
}

export interface RunFinishedEvent extends ExecutionEventBase {
  type: "run.finished";
  status: Extract<AgentRunStatus, "completed" | "failed" | "cancelled">;
}

export type ExecutionEvent =
  | RunStartedEvent
  | CapabilityCalledEvent
  | CapabilityCompletedEvent
  | RunFinishedEvent;

export type ExecutionEventHandler = (
  event: ExecutionEvent,
) => void | Promise<void>;
