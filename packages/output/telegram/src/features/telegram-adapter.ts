import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type {
  InputInterface,
  InputListener,
  InputMessage,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";
import { TelegramApi } from "./telegram-api.js";
import type { TelegramAdapterOptions, TelegramUpdate } from "./types.js";

const MAX_MESSAGE_LENGTH = 4_096;

/** Telegram long-polling input and correlated output adapter. */
export class TelegramAdapter implements InputInterface, OutputInterface {
  readonly channel = "telegram" as const;
  readonly description =
    "The Telegram chat that originated this message or the configured chat";

  private readonly api: TelegramApi;
  private readonly chatId: string;
  private readonly contexts = new AsyncLocalStorage<string>();
  private readonly sessions = new Map<string, string>();
  private readonly pollTimeoutSeconds: number;
  private readonly onError?: TelegramAdapterOptions["onError"];
  private abort?: AbortController;
  private listening = false;
  private offset = 0;

  constructor(options: TelegramAdapterOptions) {
    const botToken = requireOption(options.botToken, "botToken");
    this.chatId = requireOption(options.chatId, "chatId");
    this.api = new TelegramApi(botToken, options.fetch ?? globalThis.fetch);
    this.pollTimeoutSeconds = Math.max(0, options.pollTimeoutSeconds ?? 25);
    this.onError = options.onError;
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) throw new Error("Telegram listener is already running");
    this.listening = true;
    this.abort = new AbortController();

    try {
      while (this.listening) await this.poll(listener);
    } finally {
      this.listening = false;
      this.abort = undefined;
    }
  }

  async stop(): Promise<void> {
    this.listening = false;
    this.abort?.abort();
  }

  async write(content: OutputContent): Promise<void> {
    const text =
      typeof content === "string" ? content : await collectStream(content);
    if (text.length === 0) return;

    const chatId = this.contexts.getStore() ?? this.chatId;
    for (const chunk of splitMessage(text)) {
      await this.api.sendMessage(chatId, chunk);
    }
  }

  private async poll(listener: InputListener): Promise<void> {
    try {
      const updates = await this.api.getUpdates(
        this.offset,
        this.pollTimeoutSeconds,
        this.abort?.signal,
      );
      for (const update of updates) await this.handleUpdate(update, listener);
    } catch (error) {
      if (!this.listening || this.abort?.signal.aborted) return;
      await this.onError?.(error);
      await delay(1_000);
    }
  }

  private async handleUpdate(
    update: TelegramUpdate,
    listener: InputListener,
  ): Promise<void> {
    this.offset = Math.max(this.offset, update.update_id + 1);
    const message = update.message;
    const text = message?.text?.trim();
    if (!message || !text) return;

    const chatId = String(message.chat.id);
    if (chatId !== this.chatId) return;
    if (text === "/new") {
      this.sessions.set(chatId, createSessionId(chatId));
      await this.api.sendMessage(chatId, "Started a new conversation.");
      return;
    }

    const input: InputMessage = {
      id: `telegram-${message.message_id}`,
      channel: this.channel,
      sessionId: this.session(chatId),
      userId: message.from ? String(message.from.id) : undefined,
      text,
      createdAt: new Date(message.date * 1_000),
      metadata: {
        preferredOutputChannel: this.channel,
        chatId,
        messageId: message.message_id,
      },
    };
    await this.contexts.run(chatId, () => listener(input));
  }

  private session(chatId: string): string {
    const current = this.sessions.get(chatId);
    if (current) return current;
    const created = createSessionId(chatId);
    this.sessions.set(chatId, created);
    return created;
  }
}

function createSessionId(chatId: string): string {
  return `telegram-${chatId}-${randomUUID()}`;
}

function requireOption(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized) return normalized;
  throw new Error(`TelegramAdapter requires a non-empty ${name}`);
}

async function collectStream(content: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of content) chunks.push(chunk);
  return chunks.join("");
}

function splitMessage(text: string): string[] {
  const codePoints = [...text];
  const chunks: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += MAX_MESSAGE_LENGTH) {
    chunks.push(codePoints.slice(offset, offset + MAX_MESSAGE_LENGTH).join(""));
  }
  return chunks;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
