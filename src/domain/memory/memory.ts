import type { MemoryEntry } from "./memory-entry.js";
import type { MemoryQuery } from "./memory-query.js";

/** Persistent memory store used by Agent OS and conversation history. */
export interface Memory {
  remember(entry: MemoryEntry): Promise<void>;
  get(id: string): Promise<MemoryEntry | undefined>;
  recall(query?: MemoryQuery): Promise<readonly MemoryEntry[]>;
  forget(id: string): Promise<boolean>;
  clear(query?: MemoryQuery): Promise<number>;
  close?(): Promise<void>;
}
