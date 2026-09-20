import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import {
	renderRealtimeConversationInput,
	renderRealtimeDelegation,
} from "./prompts.ts";
import {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	CODEX_VOICE_SETUP_MESSAGE_TYPE,
	REALTIME_DELEGATION_MESSAGE_TYPE,
	REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
	VOICE_CONTEXT_MESSAGE_TYPE,
} from "./message-types.ts";

export {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	REALTIME_DELEGATION_MESSAGE_TYPE,
	REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
	VOICE_CONTEXT_MESSAGE_TYPE,
} from "./message-types.ts";

export type CodexVoiceMode = "realtime" | "dictation";
export type CodexVoiceModeState = "started" | "ended";

export interface RealtimeVoiceMessageDetails {
	input: string;
	route: "conversation" | "delegation";
	error?: string | undefined;
}

export interface CodexVoiceModeMessageDetails {
	mode: CodexVoiceMode;
	state: CodexVoiceModeState;
}

interface CodexVoiceSetupMessageDetails {
	instructions: string;
}

interface VoiceContextMessageDetails {
	summary: string;
}

export interface RealtimeUserTranscriptMessageDetails {
	transcript: string;
}

export function realtimeVoiceMessage(
	input: string,
	route: RealtimeVoiceMessageDetails["route"],
	transcriptDelta?: string,
) {
	return {
		customType:
			route === "delegation"
				? REALTIME_DELEGATION_MESSAGE_TYPE
				: REALTIME_VOICE_MESSAGE_TYPE,
		content:
			route === "delegation"
				? renderRealtimeDelegation(input, transcriptDelta)
				: renderRealtimeConversationInput(input),
		display: route !== "delegation",
		details: { input, route } satisfies RealtimeVoiceMessageDetails,
	};
}

export function codexVoiceModeMessage(
	mode: CodexVoiceMode,
	state: CodexVoiceModeState,
) {
	return {
		customType: CODEX_VOICE_MODE_MESSAGE_TYPE,
		content: modeStateContent(mode, state),
		display: true,
		details: { mode, state } satisfies CodexVoiceModeMessageDetails,
	};
}

export function codexVoiceSetupMessage(instructions: string) {
	return {
		customType: CODEX_VOICE_SETUP_MESSAGE_TYPE,
		content: instructions,
		display: true,
		details: { instructions } satisfies CodexVoiceSetupMessageDetails,
	};
}

export function registerCodexVoiceRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_VOICE_MESSAGE_TYPE,
		(message, _options, theme) => {
			const input =
				typeof message.details?.input === "string"
					? message.details.input
					: "Voice request";
			return voiceBox(theme, "Realtime Voice", input);
		},
	);
	pi.registerMessageRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_DELEGATION_MESSAGE_TYPE,
		(message, _options, theme) => {
			const input =
				typeof message.details?.input === "string"
					? message.details.input
					: "Voice request";
			const box = new Box(1, 1, (text) => theme.bg("userMessageBg", text));
			box.addChild(new Text(theme.fg("userMessageText", input), 0, 0));
			return box;
		},
	);
	pi.registerEntryRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_VOICE_MESSAGE_TYPE,
		(entry, _options, theme) => {
			const input =
				typeof entry.data?.input === "string"
					? entry.data.input
					: "Voice request";
			return voiceBox(theme, "Realtime Voice", input);
		},
	);
	pi.registerEntryRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_DELEGATION_MESSAGE_TYPE,
		(entry, _options, theme) => {
			const input =
				typeof entry.data?.input === "string"
					? entry.data.input
					: "Voice delegation unavailable.";
			const error = typeof entry.data?.error === "string"
				? `\n\nNot sent: ${entry.data.error}`
				: "";
			return voiceBox(theme, "Voice delegation", `${input}${error}`);
		},
	);
	pi.registerEntryRenderer<RealtimeUserTranscriptMessageDetails>(
		REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
		(entry, _options, theme) => {
			const transcript =
				typeof entry.data?.transcript === "string"
					? entry.data.transcript
					: "Voice transcript unavailable.";
			return voiceBox(theme, "You said", transcript);
		},
	);
	pi.registerEntryRenderer<VoiceContextMessageDetails>(
		VOICE_CONTEXT_MESSAGE_TYPE,
		(entry, _options, theme) => {
			const summary =
				typeof entry.data?.summary === "string"
					? entry.data.summary
					: "No voice context summary.";
			return voiceBox(theme, "Voice Context", summary);
		},
	);
	pi.registerMessageRenderer<CodexVoiceModeMessageDetails>(
		CODEX_VOICE_MODE_MESSAGE_TYPE,
		(message, _options, theme) => {
			const mode =
				message.details?.mode === "dictation" ? "dictation" : "realtime";
			const state = message.details?.state === "ended" ? "ended" : "started";
			return voiceBox(
				theme,
				mode === "dictation" ? "Codex Dictation" : "Realtime Voice",
				modeStateDisplay(mode, state),
			);
		},
	);
	pi.registerEntryRenderer<CodexVoiceModeMessageDetails>(
		CODEX_VOICE_MODE_MESSAGE_TYPE,
		(entry, _options, theme) => {
			const mode = entry.data?.mode === "dictation" ? "dictation" : "realtime";
			const state = entry.data?.state === "ended" ? "ended" : "started";
			return voiceBox(
				theme,
				mode === "dictation" ? "Codex Dictation" : "Realtime Voice",
				modeStateDisplay(mode, state),
			);
		},
	);
	pi.registerMessageRenderer<CodexVoiceSetupMessageDetails>(
		CODEX_VOICE_SETUP_MESSAGE_TYPE,
		(message, _options, theme) => {
			const instructions =
				typeof message.details?.instructions === "string"
					? message.details.instructions
					: typeof message.content === "string"
						? message.content
						: "Codex voice audio setup is required.";
			return voiceBox(theme, "Codex Voice Setup", instructions);
		},
	);
}

function voiceBox(theme: Theme, labelText: string, bodyText: string): Box {
	const label = theme.bold(theme.fg("customMessageLabel", labelText));
	const body = theme.fg("customMessageText", bodyText);
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	box.addChild(new Text(`${label}\n${body}`, 0, 0));
	return box;
}

function modeStateContent(
	mode: CodexVoiceMode,
	state: CodexVoiceModeState,
): string {
	if (state === "ended") {
		return mode === "dictation"
			? '<codex_voice_mode mode="dictation" state="ended">Dictation ended. Subsequent user messages are ordinary typed input unless another mode marker says otherwise.</codex_voice_mode>'
			: `<realtime_voice_session state="ended">
Transcript tails may contain unhandled user requests. Resume normal response formatting.
</realtime_voice_session>`;
	}
	return mode === "dictation"
		? '<codex_voice_mode mode="dictation" state="active">Dictation is active. User messages may contain speech-recognition errors or missing punctuation. Resolve obvious errors from context and clarify only material ambiguity.</codex_voice_mode>'
		: `<realtime_voice_session state="active">
Treat realtime_delegation as a user request; typed messages remain ordinary chat.
During ongoing work, send brief assistant progress messages between tool calls rather than staying silent until the final answer. Report findings, decisions, blockers or next steps, not routine tool calls.
Write delegation replies for speech; include links, code, commands or tables only when requested.
Ask clarifying questions in ordinary text; use interactive handoffs only when requested.
</realtime_voice_session>`;
}

function modeStateDisplay(
	mode: CodexVoiceMode,
	state: CodexVoiceModeState,
): string {
	if (state === "ended")
		return mode === "dictation"
			? "Ended · Subsequent prompts are ordinary typed input."
			: "Ended · The voice session has closed; any remaining transcript follows separately.";
	return mode === "dictation"
		? "Active · Dictated prompts may contain recognition errors or missing punctuation."
		: "Active · A voice assistant is conversing with the user and may delegate work to Pi.";
}
