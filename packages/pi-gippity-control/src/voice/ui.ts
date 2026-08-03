import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import {
	renderRealtimeConversationInput,
	renderRealtimeDelegation,
} from "./prompts.ts";

export const REALTIME_VOICE_MESSAGE_TYPE = "gippity-realtime-voice";
export const REALTIME_DELEGATION_MESSAGE_TYPE = "gippity-realtime-delegation";
export const REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE =
	"gippity-realtime-user-transcript";
export const CODEX_VOICE_MODE_MESSAGE_TYPE = "gippity-voice-mode";
const CODEX_VOICE_SETUP_MESSAGE_TYPE = "gippity-voice-setup";
export const VOICE_CONTEXT_MESSAGE_TYPE = "gippity-voice-context";

export type CodexVoiceMode = "realtime" | "dictation";
export type CodexVoiceModeState = "started" | "ended";

export interface RealtimeVoiceMessageDetails {
	input: string;
	route: "conversation" | "delegation";
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
		(message, _options, theme) => voiceTurnBox(message.details, theme),
	);
	pi.registerMessageRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_DELEGATION_MESSAGE_TYPE,
		(message, _options, theme) => userTurnBox(message.details, theme),
	);
	pi.registerEntryRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_VOICE_MESSAGE_TYPE,
		(entry, _options, theme) => voiceTurnBox(entry.data, theme),
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
		(message, _options, theme) => voiceModeBox(message.details, theme),
	);
	pi.registerEntryRenderer<CodexVoiceModeMessageDetails>(
		CODEX_VOICE_MODE_MESSAGE_TYPE,
		(entry, _options, theme) => voiceModeBox(entry.data, theme),
	);
	pi.registerMessageRenderer<CodexVoiceSetupMessageDetails>(
		CODEX_VOICE_SETUP_MESSAGE_TYPE,
		(message, _options, theme) => {
			const instructions =
				typeof message.details?.instructions === "string"
					? message.details.instructions
					: typeof message.content === "string"
						? message.content
						: "GipPity audio setup is required.";
			return voiceBox(theme, "GipPity Setup", instructions);
		},
	);
}

function voiceTurnBox(
	details: RealtimeVoiceMessageDetails | undefined,
	theme: Theme,
): Box {
	const input =
		typeof details?.input === "string" ? details.input : "Voice request";
	return voiceBox(theme, "Realtime Voice", input);
}

function userTurnBox(
	details: RealtimeVoiceMessageDetails | undefined,
	theme: Theme,
): Box {
	const input =
		typeof details?.input === "string" ? details.input : "Voice request";
	const box = new Box(1, 1, (text) => theme.bg("userMessageBg", text));
	box.addChild(new Text(theme.fg("userMessageText", input), 0, 0));
	return box;
}

function voiceModeBox(
	details: CodexVoiceModeMessageDetails | undefined,
	theme: Theme,
): Box {
	const mode = details?.mode === "dictation" ? "dictation" : "realtime";
	const state = details?.state === "ended" ? "ended" : "started";
	return voiceBox(
		theme,
		mode === "dictation" ? "Dictation" : "Realtime Voice",
		modeStateDisplay(mode, state),
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
The realtime voice session has closed. This lifecycle event carries no task. Evaluate any subsequent transcript-tail context normally; it may contain an unhandled user request.

Resume normal conversation, tool use, and formatting appropriate for the task at hand.
</realtime_voice_session>`;
	}
	return mode === "dictation"
		? '<codex_voice_mode mode="dictation" state="active">Dictation is active. User messages may contain speech-recognition errors or missing punctuation. Resolve obvious errors from context and clarify only material ambiguity.</codex_voice_mode>'
		: `<realtime_voice_session state="active">
A separate voice assistant is now conversing with the user. This lifecycle event carries no task. Handle any subsequent realtime_delegation as an ordinary authoritative user request.

The user may also send ordinary typed messages directly to Pi. Handle them normally; only realtime_delegation messages represent voice-agent delegation.

During longer delegated work, include brief user-facing progress text in assistant messages between tool calls. Keep everyone informed and up to date with what you're doing. Report meaningful progress or the next step; do not narrate routine commands.

Shape all replies to realtime delegations for spoken delivery. Prefer concise, natural language; include raw links, code, command lines, tables, or similarly visual detail only when the user specifically requests them.

Preserve the spoken flow. Do not invoke ask-questions tools or similar interactive handoffs unless the user specifically requests them. Ask necessary clarifying questions in ordinary assistant text instead.
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
