import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
} from "./message-types.ts";

export interface VoiceCallContext {
	sessionId: string;
	/** Raw branch cursor through which the summary (if any) covers voice history. */
	through: string | null;
	summary?: string | undefined;
}

export function voiceTranscriptSince(
	branch: readonly SessionEntry[],
	through: string | null,
): string | undefined {
	const index =
		through === null ? -1 : branch.findIndex((entry) => entry.id === through);
	// A missing cursor is a different branch, not the start of this one.
	if (through !== null && index < 0) return undefined;
	const lines: string[] = [];
	for (let i = index + 1; i < branch.length; i++) {
		const entry = branch[i];
		if (
			entry?.type !== "custom" ||
			!entry.data ||
			typeof entry.data !== "object"
		)
			continue;
		if (
			entry.customType === REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE &&
			"transcript" in entry.data &&
			typeof entry.data.transcript === "string"
		)
			lines.push(`User: ${entry.data.transcript}`);
		else if (
			entry.customType === REALTIME_VOICE_MESSAGE_TYPE &&
			"input" in entry.data &&
			typeof entry.data.input === "string"
		)
			lines.push(`Assistant: ${entry.data.input}`);
	}
	return lines.join("\n");
}

export function priorVoiceCallHistory(
	call: VoiceCallContext | undefined,
	sessionId: string,
	branch: readonly SessionEntry[],
): string | undefined {
	if (!call || call.sessionId !== sessionId) return undefined;
	const transcript = voiceTranscriptSince(branch, call.through);
	if (transcript === undefined) return undefined;
	return (
		[
			call.summary && `## Earlier voice continuity summary\n\n${call.summary}`,
			transcript &&
				`## Voice conversation since that checkpoint\n\n${transcript}`,
		]
			.filter(Boolean)
			.join("\n\n") || undefined
	);
}
