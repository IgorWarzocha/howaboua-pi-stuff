import type { RawData } from "ws";
import { decodeLanVoiceAudioCommand } from "./protocol.ts";

export const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_PCM_BYTES = 24_000 * 2;

export type LanVoiceBrowserInput =
	| { type: "audio"; pcm: Buffer }
	| { type: "control"; command: ReturnType<typeof decodeLanVoiceAudioCommand> };

export function decodeLanVoiceBrowserInput(data: RawData, isBinary: boolean): LanVoiceBrowserInput {
	const buffer = rawBuffer(data);
	if (isBinary) {
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_PCM_BYTES || buffer.byteLength % 2 !== 0) throw new Error("Invalid LAN voice PCM frame");
		return { type: "audio", pcm: buffer };
	}
	const text = buffer.toString("utf8");
	if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error("LAN voice control message is too large");
	return { type: "control", command: decodeLanVoiceAudioCommand(JSON.parse(text)) };
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function rawBuffer(data: RawData): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.from(data);
}
