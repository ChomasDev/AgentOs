import type { CapabilityResult } from "../capabilities/capability-result.js";

/** A provider-neutral function/tool call requested by the model. */
export interface CapabilityCall<TArguments = unknown> {
  id: string;
  capabilityId: string;
  arguments: TArguments;
  createdAt: Date;
}

/** The result returned to the model after a capability call is executed. */
export interface CapabilityCallOutcome<TOutput = unknown> {
  callId: string;
  capabilityId: string;
  result: CapabilityResult<TOutput>;
  completedAt: Date;
}
