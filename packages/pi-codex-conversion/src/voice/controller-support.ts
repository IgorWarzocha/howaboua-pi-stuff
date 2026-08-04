import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { CodexDictationSession } from "./dictation/session.ts";
import {
	formatCodexVoicePromptSchemaMismatch,
	getProjectCodexVoiceSystemPromptPath,
	loadCodexVoiceSystemPrompt,
	prepareCodexVoiceSystemPrompt,
} from "./system-prompt.ts";
import type { CodexVoiceMode } from "./ui.ts";

export const VOICE_STATUS_KEY = "codex-voice";

export type VoiceSession = CodexRealtimeConversation | CodexDictationSession;
export type VoiceState =
	| { type: "idle" }
	| { type: "connecting"; mode: "realtime"; phase: "authorizing" }
	| { type: "connecting"; mode: "realtime"; phase: "starting"; session: CodexRealtimeConversation }
	| { type: "connecting"; mode: "dictation"; phase: "authorizing" }
	| { type: "connecting"; mode: "dictation"; phase: "starting"; session: CodexDictationSession }
	| { type: "conversation"; session: CodexRealtimeConversation }
	| { type: "dictation"; session: CodexDictationSession }
	| { type: "failed"; message: string };

export function currentVoiceSession(state: VoiceState): VoiceSession | undefined {
	if (state.type === "conversation" || state.type === "dictation") return state.session;
	return state.type === "connecting" && state.phase === "starting" ? state.session : undefined;
}

export function voiceModeForState(state: Exclude<VoiceState, { type: "idle" } | { type: "failed" }>): CodexVoiceMode {
	return state.type === "connecting"
		? state.mode
		: state.type === "dictation" ? "dictation" : "realtime";
}

export function prepareRealtimeVoicePrompt(ctx: ExtensionContext): string | undefined {
	try {
		const status = prepareCodexVoiceSystemPrompt();
		if (!status.current) ctx.ui.notify(formatCodexVoicePromptSchemaMismatch(status.currentSchemaVersion), "warning");
		return loadCodexVoiceSystemPrompt(undefined, ctx.isProjectTrusted() ? getProjectCodexVoiceSystemPromptPath(ctx.cwd) : undefined);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		return undefined;
	}
}

export function renderVoiceStatus(ctx: ExtensionContext | undefined, status: string, muted: boolean): void {
	if (!ctx || !status) return;
	const mute = muted ? ctx.ui.theme.fg("warning", " · mic muted") : "";
	ctx.ui.setStatus(VOICE_STATUS_KEY, `${ctx.ui.theme.fg("accent", `voice: ${status}`)}${mute}`);
}
