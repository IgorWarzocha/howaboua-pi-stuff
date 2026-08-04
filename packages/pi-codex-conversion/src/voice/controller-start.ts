import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "./auth.ts";
import { CANCELLED, interruptible } from "./cancellation.ts";
import {
	buildRealtimeInitialItems,
	type RealtimeInitialMessageItem,
} from "./context.ts";
import {
	startControllerConversation,
	startControllerDictation,
} from "./controller-sessions.ts";
import {
	currentVoiceSession,
	VOICE_STATUS_KEY,
	type VoiceState,
} from "./controller-support.ts";
import type { CodexRealtimePeer } from "./conversation/peer.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { CodexVoiceSessionMessages } from "./session-messages.ts";
import type { CodexVoiceMode } from "./ui.ts";

export interface VoiceControllerRuntime {
	state: VoiceState;
	context?: ExtensionContext | undefined;
	config?: CodexConversionConfig | undefined;
	announcedMode?: CodexVoiceMode | undefined;
	startGeneration: number;
	startAbortController?: AbortController | undefined;
	voiceStatus: string;
}

export async function startControllerMode(options: {
	runtime: VoiceControllerRuntime;
	messages: CodexVoiceSessionMessages;
	ctx: ExtensionContext;
	config: CodexConversionConfig;
	mode: CodexVoiceMode;
	peer?: CodexRealtimePeer | undefined;
	signal?: AbortSignal | undefined;
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined;
	stopCurrent(): Promise<void>;
	finishCurrentDictation(): Promise<void>;
	onError(error: Error): void;
	onStatus(status: string): void;
}): Promise<CodexRealtimeConversation | undefined> {
	const { runtime, peer, signal } = options;
	if (signal?.aborted) {
		await peer?.close();
		return;
	}
	const realtimePrompt =
		options.mode === "realtime"
			? options.prepareRealtimePrompt(options.ctx)
			: undefined;
	if (options.mode === "realtime" && realtimePrompt === undefined) return;
	if (runtime.state.type === "dictation")
		await options.finishCurrentDictation();
	else await options.stopCurrent();
	if (signal?.aborted) {
		await peer?.close();
		return;
	}
	const startAbortController = new AbortController();
	runtime.startAbortController = startAbortController;
	const startSignal = signal
		? AbortSignal.any([signal, startAbortController.signal])
		: startAbortController.signal;
	const startGeneration = ++runtime.startGeneration;
	runtime.context = options.ctx;
	runtime.config = options.config;
	options.messages.setContext(options.ctx);
	runtime.state =
		options.mode === "realtime"
			? { type: "connecting", mode: "realtime", phase: "authorizing" }
			: { type: "connecting", mode: "dictation", phase: "authorizing" };
	options.onStatus("connecting…");
	let realtimeSummary: string | undefined;
	try {
		const startup = await interruptible(
			Promise.all([
				resolveCodexVoiceAuth(options.ctx),
				options.mode === "realtime"
					? buildRealtimeInitialItems({
							ctx: options.ctx,
							config: options.config,
							onSummary: (summary) => {
								realtimeSummary = summary;
							},
							signal: startSignal,
						})
					: Promise.resolve(undefined),
			]),
			startSignal,
		);
		if (startup === CANCELLED) {
			await peer?.close();
			cancelStart(runtime, startGeneration);
			return;
		}
		const [auth, initialItems] = startup;
		if (
			startGeneration !== runtime.startGeneration ||
			runtime.state.type !== "connecting"
		) {
			await peer?.close();
			return;
		}
		if (options.mode === "dictation") await startDictation(options, auth);
		else
			await startConversation(
				options,
				auth,
				realtimePrompt!,
				initialItems,
				startSignal,
			);
		if (startSignal.aborted) {
			await peer?.close();
			cancelStart(runtime, startGeneration);
			return;
		}
		const activeState = snapshotState(runtime);
		if (options.mode === "realtime") {
			if (activeState.type !== "conversation") {
				await peer?.close();
				return;
			}
			if (realtimeSummary) options.messages.contextSummary(realtimeSummary);
			runtime.announcedMode = options.mode;
			options.messages.modeStarted(options.mode);
			return activeState.session;
		}
		if (activeState.type !== "dictation") return;
		runtime.announcedMode = options.mode;
		options.messages.modeStarted(options.mode);
		return undefined;
	} catch (error) {
		if (startSignal.aborted) {
			await peer?.close();
			cancelStart(runtime, startGeneration);
			return;
		}
		if (startGeneration !== runtime.startGeneration) {
			await peer?.close();
			return;
		}
		options.onError(error instanceof Error ? error : new Error(String(error)));
		return undefined;
	}
}

async function startConversation(
	options: Parameters<typeof startControllerMode>[0],
	auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
	instructions: string,
	initialItems: RealtimeInitialMessageItem[] | undefined,
	signal: AbortSignal,
): Promise<void> {
	const { runtime } = options;
	const connecting = runtime.state;
	if (
		connecting.type !== "connecting" ||
		connecting.mode !== "realtime" ||
		connecting.phase !== "authorizing"
	)
		return;
	await startControllerConversation({
		auth,
		config: options.config,
		instructions,
		initialItems,
		peer: options.peer,
		signal,
		lifecycle: {
			stillAuthorizing: () => runtime.state === connecting,
			onCreated: (session) => {
				runtime.state = {
					type: "connecting",
					mode: "realtime",
					phase: "starting",
					session,
				};
			},
			isCurrent: (session) => currentVoiceSession(runtime.state) === session,
			onActive: (session) => {
				runtime.state = { type: "conversation", session };
			},
			onError: (session, error) => {
				if (currentVoiceSession(runtime.state) === session)
					options.onError(error);
			},
			onStatus: options.onStatus,
			onTurn: (turn) => options.messages.voiceTurn(turn),
			onUserTranscript: (transcript) =>
				options.messages.userTranscript(transcript),
			onTranscriptTail: (transcript) =>
				options.messages.retainTranscriptTail(transcript),
		},
	});
}

async function startDictation(
	options: Parameters<typeof startControllerMode>[0],
	auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
): Promise<void> {
	const { runtime } = options;
	const connecting = runtime.state;
	if (
		connecting.type !== "connecting" ||
		connecting.mode !== "dictation" ||
		connecting.phase !== "authorizing"
	)
		return;
	await startControllerDictation({
		auth,
		config: options.config,
		lifecycle: {
			stillAuthorizing: () => runtime.state === connecting,
			onCreated: (session) => {
				runtime.state = {
					type: "connecting",
					mode: "dictation",
					phase: "starting",
					session,
				};
			},
			isCurrent: (session) => currentVoiceSession(runtime.state) === session,
			onActive: (session) => {
				runtime.state = { type: "dictation", session };
			},
			onError: (session, error) => {
				if (currentVoiceSession(runtime.state) === session)
					options.onError(error);
			},
			onStatus: options.onStatus,
			onTranscript: (transcript) =>
				runtime.context?.ui.pasteToEditor(transcript),
		},
	});
}

function cancelStart(
	runtime: VoiceControllerRuntime,
	startGeneration: number,
): void {
	if (startGeneration !== runtime.startGeneration) return;
	runtime.state = { type: "idle" };
	runtime.config = undefined;
	runtime.voiceStatus = "";
	runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
}

function snapshotState(runtime: VoiceControllerRuntime): VoiceState {
	return runtime.state;
}
