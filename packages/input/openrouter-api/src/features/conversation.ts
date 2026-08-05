import { HttpError } from "./http-error.js";
import type { ChatCompletionMessage } from "./types.js";
import { isRecord, normalizeText, serialize } from "./utils.js";

export function renderConversation(
  messages: readonly ChatCompletionMessage[],
): string {
  const hasContent = messages.some(
    (message) =>
      renderContent(message.content).trim() || message.tool_calls !== undefined,
  );
  if (!hasContent) {
    throw new HttpError(
      400,
      "At least one message must contain text or tool calls",
      "invalid_request",
    );
  }

  const rendered = messages.map(renderMessage).join("\n\n");
  return `Conversation supplied through an OpenRouter-compatible API:\n\n${rendered}`;
}

export function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    return content == null ? "" : serialize(content);
  }
  return content.map(renderPart).join("\n");
}

function renderMessage(message: ChatCompletionMessage): string {
  const labels = [message.role.toUpperCase()];
  if (message.name) labels.push(` (${message.name})`);
  if (message.tool_call_id) {
    labels.push(` [tool_call_id=${message.tool_call_id}]`);
  }

  const sections = [`${labels.join("")}:`, renderContent(message.content)];
  if (message.tool_calls !== undefined) {
    sections.push(`Tool calls: ${serialize(message.tool_calls)}`);
  }
  return sections.filter(Boolean).join("\n");
}

function renderPart(part: unknown): string {
  if (!isRecord(part)) return serialize(part);
  if (
    (part.type === "text" || part.type === "input_text") &&
    typeof part.text === "string"
  ) {
    return part.text;
  }
  if (part.type !== "image_url") return serialize(part);

  const url = imageUrl(part.image_url);
  return url ? `[Image: ${url}]` : "[Image]";
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return isRecord(value) ? normalizeText(value.url) : undefined;
}
