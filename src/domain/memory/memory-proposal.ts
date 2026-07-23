import type { MemoryKind } from "./memory-entry.js";

/**
 * Models may propose memory changes; an application policy decides whether to
 * persist them.
 */
export type MemoryProposal =
  | {
      operation: "remember";
      kind: MemoryKind;
      content: unknown;
      reason: string;
      confidence?: number;
    }
  | {
      operation: "forget";
      memoryId: string;
      reason: string;
    };
