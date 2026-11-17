export type LanVoiceAudioCommand =
	| {
			type: "start";
			mode: "conversation" | "dictation";
			takeoverToken?: string;
			playbackDrain?: boolean;
	  }
	| { type: "mute"; muted: boolean }
	| { type: "drained"; id: string }
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
		if ("playbackDrain" in value && typeof value.playbackDrain !== "boolean")
			throw invalidCommand();
		const playbackDrain =
			"playbackDrain" in value && value.playbackDrain === true;
		if (
			!("mode" in value) ||
			(value.mode !== "conversation" && value.mode !== "dictation")
		)
			throw invalidCommand();
		if ("takeoverToken" in value) {
			if (
				value.mode !== "conversation" ||
				typeof value.takeoverToken !== "string" ||
				!/^[a-f0-9-]{36}$/.test(value.takeoverToken)
			)
				throw invalidCommand();
			return {
				type: "start",
				mode: value.mode,
				takeoverToken: value.takeoverToken,
				...(playbackDrain ? { playbackDrain } : {}),
			};
		}
		return {
			type: "start",
			mode: value.mode,
			...(playbackDrain ? { playbackDrain } : {}),
		};
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
	if (value.type === "drained") {
		if (
			!("id" in value) ||
			typeof value.id !== "string" ||
			!/^[a-f0-9-]{36}$/.test(value.id)
		)
			throw invalidCommand();
		return { type: "drained", id: value.id };
	}
	if (value.type === "release" || value.type === "cancel")
		return { type: value.type };
	throw invalidCommand();
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
