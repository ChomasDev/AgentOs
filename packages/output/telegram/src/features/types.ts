export interface TelegramAdapterOptions {
  botToken: string;
  chatId: string;
  fetch?: typeof globalThis.fetch;
  pollTimeoutSeconds?: number;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number | string };
    from?: { id: number | string };
  };
}

export interface TelegramApiResponse<T = unknown> {
  ok?: boolean;
  description?: string;
  result?: T;
}
