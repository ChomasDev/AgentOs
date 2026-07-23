import type { MemoryKind } from "./memory-entry.js";

export interface MemoryQuery {
  text?: string;
  kinds?: readonly MemoryKind[];
  userId?: string;
  sessionId?: string;
  limit?: number;
  minImportance?: number;
  metadata?: Readonly<Record<string, unknown>>;
}
