import type {
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";

export interface TelegramOutputOptions {
  botToken: string;
  chatId: string;
  fetch?: typeof globalThis.fetch;
}

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
}

const maxTelegramMessageLength = 4_096;

/** Sends Agent OS responses to one configured Telegram chat. */
export class TelegramOutput implements OutputInterface {
  readonly channel = "telegram";
  readonly description =
    "Telegram messaging destination for delivering completed reports and messages";

  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: TelegramOutputOptions) {
    this.botToken = requireOption(options.botToken, "botToken");
    this.chatId = requireOption(options.chatId, "chatId");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async write(content: OutputContent): Promise<void> {
    const text =
      typeof content === "string" ? content : await collectStream(content);

    if (text.length === 0) {
      return;
    }

    for (const chunk of splitMessage(text)) {
      await this.sendMessage(chunk);
    }
  }

  private async sendMessage(text: string): Promise<void> {
    const response = await this.fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
        }),
      },
    );
    const result = (await response.json()) as TelegramApiResponse;

    if (!response.ok || result.ok !== true) {
      throw new Error(
        `Telegram sendMessage failed (${response.status}): ${
          result.description ?? response.statusText
        }`,
      );
    }
  }
}

function requireOption(value: string, name: string): string {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error(`TelegramOutput requires a non-empty ${name}`);
  }

  return normalized;
}

async function collectStream(content: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of content) {
    chunks.push(chunk);
  }

  return chunks.join("");
}

function splitMessage(text: string): string[] {
  const codePoints = [...text];
  const chunks: string[] = [];

  for (
    let offset = 0;
    offset < codePoints.length;
    offset += maxTelegramMessageLength
  ) {
    chunks.push(
      codePoints
        .slice(offset, offset + maxTelegramMessageLength)
        .join(""),
    );
  }

  return chunks;
}
