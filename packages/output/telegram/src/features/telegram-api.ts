import type {
  TelegramApiResponse,
  TelegramUpdate,
} from "./types.js";

export class TelegramApi {
  constructor(
    private readonly botToken: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async getUpdates(
    offset: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<readonly TelegramUpdate[]> {
    const result = await this.call<TelegramUpdate[]>(
      "getUpdates",
      { offset, timeout, allowed_updates: ["message"] },
      signal,
    );
    return result ?? [];
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    const response = await this.fetch(
      `https://api.telegram.org/bot${this.botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
    );
    const result = (await response.json()) as TelegramApiResponse<T>;
    if (response.ok && result.ok === true) return result.result;
    throw new Error(
      `Telegram ${method} failed (${response.status}): ${
        result.description ?? response.statusText
      }`,
    );
  }
}
