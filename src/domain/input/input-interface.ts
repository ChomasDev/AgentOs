export type InputChannel = "cli" | (string & {});

export interface InputMessage {
  id: string;
  channel: InputChannel;
  sessionId: string;
  text: string;
  createdAt: Date;
  metadata?: Readonly<Record<string, unknown>>;
}

export type InputListener = (
  message: InputMessage,
) => void | Promise<void>;

export interface InputInterface {
  readonly channel: InputChannel;
  start(listener: InputListener): Promise<void>;
  stop(): Promise<void>;
}
