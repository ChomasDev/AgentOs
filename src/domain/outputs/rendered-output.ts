import type {
  OutputChannel,
  OutputModality,
  OutputPurpose,
} from "./output-intent.js";

export interface RenderedOutput {
  id: string;
  intentId: string;
  channel: OutputChannel;
  modality: OutputModality;
  purpose: OutputPurpose;
  body: string;
  renderedAt: Date;
  metadata?: Readonly<Record<string, unknown>>;
}
