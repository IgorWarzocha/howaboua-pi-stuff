export type LanVoiceAudioCommand =
	| { type: "start"; mode: "conversation" | "dictation" }
	| { type: "mute"; muted: boolean }
	| { type: "finish"; draft: string; revision: number; selection: { start: number; end: number } }
	| { type: "release" }
	| { type: "cancel" };

export function decodeLanVoiceAudioCommand(value: unknown): LanVoiceAudioCommand {
	if (!value || typeof value !== "object" || Array.isArray(value) || !("type" in value)) throw invalidCommand();
	if (value.type === "start") {
		if (!("mode" in value) || (value.mode !== "conversation" && value.mode !== "dictation")) throw invalidCommand();
		return { type: "start", mode: value.mode };
	}
	if (value.type === "finish") {
		if (!("draft" in value) || typeof value.draft !== "string") throw invalidCommand();
		if (!("revision" in value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision)) throw invalidCommand();
		if (!("selectionStart" in value) || !validSelectionIndex(value.selectionStart, value.draft.length)) throw invalidCommand();
		if (!("selectionEnd" in value) || !validSelectionIndex(value.selectionEnd, value.draft.length)) throw invalidCommand();
		return {
			type: "finish",
			draft: value.draft,
			revision: value.revision,
			selection: { start: value.selectionStart, end: value.selectionEnd },
		};
	}
	if (value.type === "mute") {
		if (!("muted" in value) || typeof value.muted !== "boolean") throw invalidCommand();
		return { type: "mute", muted: value.muted };
	}
	if (value.type === "release" || value.type === "cancel") return { type: value.type };
	throw invalidCommand();
}

function validSelectionIndex(value: unknown, draftLength: number): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= draftLength;
}

function invalidCommand(): Error {
	return new Error("Invalid LAN voice control message");
}
