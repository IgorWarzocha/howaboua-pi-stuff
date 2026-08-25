import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../config.ts";
import type {
	RealtimePeerPlan,
	VoiceControllerRuntime,
} from "./controller-start.ts";
import type { VoiceSession } from "./controller-support.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";

interface RealtimeReconnectCallbacks {
	currentSession(): VoiceSession | undefined;
	fail(error: Error): void;
	inputMuted(): boolean;
	renderCurrentStatus(): void;
	renderStatus(status: string): void;
	startReplacement(
		ctx: ExtensionContext,
		config: GippityControlConfig,
		plan: RealtimePeerPlan | undefined,
		inputMuted: boolean,
	): Promise<CodexRealtimeConversation | undefined>;
}

/** Replaces an established realtime call without transferring LAN ownership. */
export function resumeDroppedConversation(options: {
	runtime: VoiceControllerRuntime;
	session: CodexRealtimeConversation;
	error: Error;
	callbacks: RealtimeReconnectCallbacks;
}): void {
	const { runtime, session, error, callbacks } = options;
	if (callbacks.currentSession() !== session) return;
	const config = runtime.config;
	const ctx = runtime.context;
	if (!config?.voice.autoResumeRealtime || !ctx) {
		markRealtimePeerInactive(runtime, session, error, false);
		callbacks.fail(error);
		return;
	}
	const realtimePeerPlan = runtime.realtimePeerPlan;
	markRealtimePeerInactive(runtime, session, error, true);
	runtime.startAbortController?.abort();
	runtime.startAbortController = undefined;
	const resumeGeneration = ++runtime.startGeneration;
	const wasMuted = callbacks.inputMuted();
	runtime.state = { type: "reconnecting", session };
	callbacks.renderStatus("reconnecting…");
	void (async () => {
		await Promise.allSettled([session.close()]);
		if (
			runtime.startGeneration !== resumeGeneration ||
			runtime.state.type !== "reconnecting"
		)
			return;
		const resumePromise = callbacks.startReplacement(
			ctx,
			config,
			realtimePeerPlan,
			wasMuted,
		);
		const replacementGeneration = runtime.startGeneration;
		let resumed: CodexRealtimeConversation | undefined;
		try {
			resumed = await resumePromise;
		} catch (resumeError) {
			if (runtime.startGeneration === replacementGeneration)
				callbacks.fail(asError(resumeError));
			return;
		}
		if (!resumed) {
			const resumeError = new Error("Codex realtime voice could not resume");
			markRealtimePeerInactive(
				runtime,
				session,
				resumeError,
				false,
				realtimePeerPlan,
			);
			if (runtime.state.type === "reconnecting") callbacks.fail(resumeError);
			return;
		}
		if (wasMuted && callbacks.currentSession() === resumed)
			callbacks.renderCurrentStatus();
	})();
}

export function markRealtimePeerInactive(
	runtime: VoiceControllerRuntime,
	session: CodexRealtimeConversation,
	error: Error,
	resuming: boolean,
	plan = runtime.realtimePeerPlan,
): void {
	try {
		plan?.onInactive?.(session, error, resuming);
	} catch (ownerError) {
		runtime.context?.ui.notify(
			`Could not update realtime voice owner: ${asError(ownerError).message}`,
			"error",
		);
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
