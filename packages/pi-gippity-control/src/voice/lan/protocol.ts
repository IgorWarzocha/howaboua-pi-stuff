import { MAX_REALTIME_SDP_BYTES } from "../conversation/peer.ts";

const MAX_PEER_DATA_BYTES = 64 * 1024;
const MAX_PEER_ERROR_BYTES = 8 * 1024;

export type LanVoiceAudioCommand =
	| { type: "start"; mode: "conversation"; sdp: string }
	| { type: "start"; mode: "dictation" }
	| { type: "mute"; muted: boolean }
	| {
			type: "peer_state";
			state: "connected" | "disconnected" | "failed" | "closed" | "ready";
	  }
	| { type: "peer_data"; message: unknown }
	| { type: "peer_error"; message: string }
	| {
			type: "finish";
			draft: string;
			revision: number;
			selection: { start: number; end: number };
	  }
	| { type: "release" }
	| { type: "cancel" };

export function decodeLanVoiceAudioCommand(
	value: unknown,
): LanVoiceAudioCommand {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!("type" in value)
	)
		throw invalidCommand();
	if (value.type === "start") {
		if (
			!("mode" in value) ||
			(value.mode !== "conversation" && value.mode !== "dictation")
		)
			throw invalidCommand();
		if (value.mode === "dictation") return { type: "start", mode: "dictation" };
		if (!("sdp" in value) || !boundedString(value.sdp, MAX_REALTIME_SDP_BYTES))
			throw invalidCommand();
		return { type: "start", mode: "conversation", sdp: value.sdp };
	}
	if (value.type === "finish") {
		if (!("draft" in value) || typeof value.draft !== "string")
			throw invalidCommand();
		if (
			!("revision" in value) ||
			typeof value.revision !== "number" ||
			!Number.isSafeInteger(value.revision)
		)
			throw invalidCommand();
		if (
			!("selectionStart" in value) ||
			!validSelectionIndex(value.selectionStart, value.draft.length)
		)
			throw invalidCommand();
		if (
			!("selectionEnd" in value) ||
			!validSelectionIndex(value.selectionEnd, value.draft.length)
		)
			throw invalidCommand();
		return {
			type: "finish",
			draft: value.draft,
			revision: value.revision,
			selection: { start: value.selectionStart, end: value.selectionEnd },
		};
	}
	if (value.type === "mute") {
		if (!("muted" in value) || typeof value.muted !== "boolean")
			throw invalidCommand();
		return { type: "mute", muted: value.muted };
	}
	if (value.type === "peer_state") {
		if (
			!("state" in value) ||
			!["connected", "disconnected", "failed", "closed", "ready"].includes(
				String(value.state),
			)
		)
			throw invalidCommand();
		return {
			type: "peer_state",
			state: value.state as
				| "connected"
				| "disconnected"
				| "failed"
				| "closed"
				| "ready",
		};
	}
	if (value.type === "peer_data") {
		if (
			!("message" in value) ||
			!boundedJson(value.message, MAX_PEER_DATA_BYTES)
		)
			throw invalidCommand();
		return { type: "peer_data", message: value.message };
	}
	if (value.type === "peer_error") {
		if (
			!("message" in value) ||
			!boundedString(value.message, MAX_PEER_ERROR_BYTES)
		)
			throw invalidCommand();
		return { type: "peer_error", message: value.message };
	}
	if (value.type === "release" || value.type === "cancel")
		return { type: value.type };
	throw invalidCommand();
}

function boundedString(value: unknown, maxBytes: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Buffer.byteLength(value) <= maxBytes
	);
}

function boundedJson(value: unknown, maxBytes: number): boolean {
	try {
		return Buffer.byteLength(JSON.stringify(value)) <= maxBytes;
	} catch {
		return false;
	}
}

function validSelectionIndex(
	value: unknown,
	draftLength: number,
): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= draftLength
	);
}

function invalidCommand(): Error {
	return new Error("Invalid LAN voice control message");
}
