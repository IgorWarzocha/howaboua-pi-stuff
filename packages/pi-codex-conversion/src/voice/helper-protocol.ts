import { MAX_REALTIME_SDP_BYTES } from "./conversation/peer.ts";

export type VoiceHelperCommand =
	| { type: "list_devices" }
	| { type: "start_v3"; microphone?: string; speaker?: string }
	| { type: "start_v3_bridge" }
	| { type: "set_input_muted"; muted: boolean }
	| { type: "apply_answer"; sdp: string }
	| { type: "start_dictation"; microphone?: string }
	| { type: "send_data"; message: unknown }
	| { type: "send_pcm"; audio: string; sample_rate: 24_000; num_channels: 1 }
	| { type: "stop" }
	| { type: "shutdown" };

export type VoiceHelperEvent =
	| { type: "ready"; version: number }
	| { type: "devices"; inputs: VoiceDevice[]; outputs: VoiceDevice[] }
	| { type: "offer"; sdp: string }
	| { type: "state"; state: string }
	| { type: "data"; message: unknown }
	| { type: "pcm"; audio: string; sample_rate: number; num_channels: number }
	| { type: "error"; message: string }
	| { type: "stopped" };

export interface VoiceDevice {
	id: string;
	name: string;
	is_default: boolean;
}

const MAX_PCM_BYTES = 64 * 1024;
const MAX_DATA_MESSAGE_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_DEVICE_BYTES = 512;
const MAX_DEVICES = 128;

export class BoundedJsonlReader {
	private readonly chunks: Buffer[] = [];
	private readonly maxLineBytes: number;
	private readonly onLine: (line: string) => void;
	private readonly onOversized: () => void;
	private byteLength = 0;
	private failed = false;

	constructor(
		maxLineBytes: number,
		onLine: (line: string) => void,
		onOversized: () => void,
	) {
		this.maxLineBytes = maxLineBytes;
		this.onLine = onLine;
		this.onOversized = onOversized;
	}

	push(chunk: Buffer): void {
		if (this.failed) return;
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(0x0a, offset);
			const end = newline === -1 ? chunk.length : newline;
			if (!this.append(chunk.subarray(offset, end))) return;
			if (newline === -1) return;
			this.emitLine();
			offset = newline + 1;
		}
	}

	end(): void {
		if (!this.failed && this.byteLength > 0) this.emitLine();
	}

	private append(chunk: Buffer): boolean {
		if (this.byteLength + chunk.length > this.maxLineBytes) {
			this.failed = true;
			this.chunks.length = 0;
			this.byteLength = 0;
			this.onOversized();
			return false;
		}
		if (chunk.length > 0) {
			this.chunks.push(Buffer.from(chunk));
			this.byteLength += chunk.length;
		}
		return true;
	}

	private emitLine(): void {
		let line = this.chunks.length === 1
			? this.chunks[0]!
			: Buffer.concat(this.chunks, this.byteLength);
		this.chunks.length = 0;
		this.byteLength = 0;
		if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
		this.onLine(line.toString("utf8"));
	}
}

export function parseVoiceHelperEvent(value: unknown): VoiceHelperEvent {
	if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") throw new Error("Invalid Codex voice helper event");
	const event = value as Record<string, unknown>;
	if (event["type"] === "ready" && Number.isSafeInteger(event["version"])) return event as VoiceHelperEvent;
	if (event["type"] === "devices" && validDevices(event["inputs"]) && validDevices(event["outputs"])) return event as VoiceHelperEvent;
	if (event["type"] === "offer" && boundedString(event["sdp"], MAX_REALTIME_SDP_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "state" && boundedString(event["state"], 128)) return event as VoiceHelperEvent;
	if (event["type"] === "data" && boundedJson(event["message"], MAX_DATA_MESSAGE_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "pcm" && validBase64(event["audio"], MAX_PCM_BYTES) && event["sample_rate"] === 24_000 && event["num_channels"] === 1) return event as VoiceHelperEvent;
	if (event["type"] === "error" && boundedString(event["message"], MAX_TEXT_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "stopped") return event as VoiceHelperEvent;
	throw new Error(`Invalid Codex voice helper ${event["type"]} event`);
}

function validDevices(value: unknown): value is VoiceDevice[] {
	return Array.isArray(value) && value.length <= MAX_DEVICES && value.every((item) => {
		if (!item || typeof item !== "object") return false;
		const device = item as Record<string, unknown>;
		return boundedString(device["id"], MAX_DEVICE_BYTES)
			&& boundedString(device["name"], MAX_DEVICE_BYTES)
			&& typeof device["is_default"] === "boolean";
	});
}

function boundedString(value: unknown, maxBytes: number): value is string {
	return typeof value === "string" && Buffer.byteLength(value) <= maxBytes;
}

function boundedJson(value: unknown, maxBytes: number): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	try { return Buffer.byteLength(JSON.stringify(value)) <= maxBytes; }
	catch { return false; }
}

function validBase64(value: unknown, maxBytes: number): value is string {
	return boundedString(value, maxBytes)
		&& value.length > 0
		&& /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
