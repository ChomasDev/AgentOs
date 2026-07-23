import type { DataArtifact } from "../artifacts/data-artifact.js";

export interface CapabilityError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface CapabilityMetrics {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

interface CapabilityResultBase {
  artifacts?: readonly DataArtifact[];
  metrics?: CapabilityMetrics;
}

export interface CapabilitySuccess<T> extends CapabilityResultBase {
  success: true;
  data: T;
}

export interface CapabilityFailure extends CapabilityResultBase {
  success: false;
  error: CapabilityError;
}

export type CapabilityResult<T = unknown> =
  | CapabilitySuccess<T>
  | CapabilityFailure;
