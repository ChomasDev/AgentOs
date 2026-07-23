import type {
  InputInterface,
  InputListener,
  InputMessage,
} from "@agent-os/core/domain";

export interface __CLASS_NAME__Options {
  sessionId?: string;
}

export class __CLASS_NAME__ implements InputInterface {
  readonly channel = "__NAME__" as const;

  private listening = false;

  constructor(private readonly options: __CLASS_NAME__Options = {}) {}

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("__CLASS_NAME__ listener is already running");
    }

    this.listening = true;
    // TODO: wire your input source and call listener(message)
    void listener;
    void this.createMessage;
  }

  async stop(): Promise<void> {
    this.listening = false;
  }

  private createMessage(text: string): InputMessage {
    return {
      id: crypto.randomUUID(),
      channel: this.channel,
      sessionId: this.options.sessionId ?? crypto.randomUUID(),
      text,
      createdAt: new Date(),
    };
  }
}
