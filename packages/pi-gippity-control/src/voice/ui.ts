import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

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
	pi.registerEntryRenderer<RealtimeVoiceMessageDetails>(
		REALTIME_DELEGATION_MESSAGE_TYPE,
		(entry, _options, theme) =>
			voiceBox(theme, "Task for Pi", entry.data?.input ?? "Voice request"),
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
Handle user requests normally. This lifecycle event carries no task.
During ongoing work, send brief assistant progress messages between tool calls. Report findings, decisions, blockers or next steps, not routine tool calls.
Keep replies clear and concise. Preserve any code, links, commands or other detail the task needs.
Ask only when missing information changes the action.
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
