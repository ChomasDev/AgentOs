export type JsonSchema = Readonly<Record<string, unknown>>;

export interface CapabilityManifest {
  /** Stable registry identifier. */
  id: string;
  /** Provider-safe function name exposed to the model. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  version?: string;
  outputSchema?: JsonSchema;
  permissions?: readonly string[];
  tags?: readonly string[];
  execution?: {
    timeoutMs?: number;
    idempotent?: boolean;
  };
  examples?: ReadonlyArray<{
    request: string;
    arguments?: unknown;
  }>;
}
