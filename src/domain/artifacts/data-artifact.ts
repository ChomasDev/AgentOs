export type DataType =
  | "text"
  | "url"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "json"
  | "message"
  | "memory"
  | "unknown";

export type TrustLevel =
  | "system"
  | "user"
  | "trusted-capability"
  | "external"
  | "untrusted";

/**
 * A value or large resource produced or consumed during a run.
 * Large payloads should use `uri`; small payloads may use `data`.
 */
export interface DataArtifact<T = unknown> {
  id: string;
  type: DataType;
  trustLevel: TrustLevel;
  createdAt: Date;
  data?: T;
  uri?: string;
  mimeType?: string;
  producer?: {
    capabilityId: string;
    callId: string;
  };
  metadata?: Readonly<Record<string, unknown>>;
}
