export type MemoryKind = "working" | "semantic" | "episodic" | "procedural";

export interface MemoryEntry<T = unknown> {
  id: string;
  kind: MemoryKind;
  content: T;
  createdAt: Date;
  userId?: string;
  sessionId?: string;
  updatedAt?: Date;
  importance?: number;
  confidence?: number;
  metadata?: Readonly<Record<string, unknown>>;
}
