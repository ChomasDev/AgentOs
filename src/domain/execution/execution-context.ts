export interface ExecutionContext {
  runId: string;
  sessionId: string;
  userId?: string;
  input?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
