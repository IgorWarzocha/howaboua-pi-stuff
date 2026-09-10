import { createHash } from "node:crypto";
import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";

export interface RealtimeVoiceEventDetails {
	callId: string;
	type: string;
	itemId?: string;
	turnId?: string;
	role?: "user" | "assistant";
	offsetMs?: number;
	textHash?: string;
	accepted: boolean;
}

export function realtimeEventIdentity(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const id = (value as Record<string, unknown>)["id"];
	return typeof id === "string" && id.length > 0 && Buffer.byteLength(id) <= 256 ? id : undefined;
}

export function realtimeEventDetails(
	callId: string,
	event: Record<string, unknown>,
	text: string | undefined,
	accepted: boolean,
): RealtimeVoiceEventDetails {
	const itemId = realtimeEventIdentity(event["item"]);
	const turnId = realtimeEventIdentity(event["turn"]);
	const offset = event["offset_ms"];
	const turn = event["turn"];
	const record = turn && typeof turn === "object" ? turn as Record<string, unknown> : undefined;
	const role = record?.["role"];
	const transcript = text ?? boundedAssistantTranscript(record?.["transcript"]);
	return {
		callId,
		type: String(event["type"]),
		...(itemId ? { itemId } : {}),
		...(turnId ? { turnId } : {}),
		...(role === "user" || role === "assistant" ? { role } : {}),
		...(typeof offset === "number" && Number.isFinite(offset) ? { offsetMs: offset } : {}),
		...(transcript ? { textHash: createHash("sha256").update(transcript).digest("hex") } : {}),
		accepted,
	};
}

export function boundedTranscript(value: unknown): string | "oversized" | undefined {
	if (typeof value !== "string") return undefined;
	const input = value.trim();
	if (!input) return undefined;
	return Buffer.byteLength(input) > MAX_REALTIME_VOICE_INPUT_BYTES ? "oversized" : input;
}

export function transcriptItemText(value: unknown): unknown {
	return value && typeof value === "object" ? (value as Record<string, unknown>)["text"] : undefined;
}

export function boundedAssistantTranscript(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const output = value.trim();
	if (!output) return undefined;
	return utf8Tail(output, MAX_REALTIME_VOICE_INPUT_BYTES - 32);
}

export function remoteError(event: Record<string, unknown>): string {
	if (typeof event["message"] === "string") return event["message"];
	const error = event["error"];
	return error && typeof error === "object" && typeof (error as Record<string, unknown>)["message"] === "string" ? (error as Record<string, unknown>)["message"] as string : "Codex realtime error";
}

export function utf8Chunks(input: string, maxBytes: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const character of input) {
		if (Buffer.byteLength(current + character) > maxBytes && current) { chunks.push(current); current = character; }
		else current += character;
	}
	if (current) chunks.push(current);
	return chunks;
}

export function realtimePeerStateFailure(state: string): string | undefined {
	if (state === "failed") return "Codex realtime connection failed";
	if (state === "closed") return "Codex realtime connection closed";
	return undefined;
}

function utf8Tail(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value) <= maxBytes) return value;
	let start = value.length;
	let bytes = 0;
	while (start > 0) {
		let characterStart = start - 1;
		const lastUnit = value.charCodeAt(characterStart);
		if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && characterStart > 0) characterStart--;
		const characterBytes = Buffer.byteLength(value.slice(characterStart, start));
		if (bytes + characterBytes > maxBytes) break;
		bytes += characterBytes;
		start = characterStart;
	}
	return value.slice(start);
}
