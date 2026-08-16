import { LIMITS } from "../src/protocol/index.ts";

const WHITESPACE_PATTERN = /\s+/g;

export function assistantReplyPreview(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (message["role"] !== "assistant" || !Array.isArray(message["content"])) return undefined;
  const parts: string[] = [];
  for (const part of message["content"]) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const content = part as Record<string, unknown>;
    if (content["type"] === "text" && typeof content["text"] === "string") parts.push(content["text"]);
  }
  const text = parts.join(" ").replace(WHITESPACE_PATTERN, " ").trim();
  if (!text) return undefined;
  if (text.length <= LIMITS.bubbleText) return text;
  const candidate = text.slice(0, LIMITS.bubbleText - 1);
  const boundary = candidate.lastIndexOf(" ");
  const clipped = boundary >= 220 ? candidate.slice(0, boundary) : candidate;
  return `${clipped}…`;
}
