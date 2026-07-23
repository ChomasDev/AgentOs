export type OutputChannel =
  | "current"
  | "voice"
  | "telegram"
  | "whatsapp"
  | "web"
  | "desktop"
  | "email"
  | (string & {});

export type OutputModality =
  | "text"
  | "voice"
  | "image"
  | "document"
  | "notification";

export type OutputPurpose =
  | "acknowledgement"
  | "result"
  | "progress"
  | "error"
  | "confirmation";

export interface OutputIntent {
  id: string;
  channel: OutputChannel;
  modality: OutputModality;
  purpose: OutputPurpose;
  content: {
    text?: string;
    artifactIds?: readonly string[];
    data?: unknown;
  };
  audience?: {
    userId?: string;
    contactId?: string;
  };
  requiresConfirmation?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}
