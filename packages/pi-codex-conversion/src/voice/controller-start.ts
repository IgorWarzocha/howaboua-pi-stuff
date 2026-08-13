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

export interface RealtimePeerPlan {
	createPeer(): CodexRealtimePeer;
	onActive?(session: CodexRealtimeConversation, peer: CodexRealtimePeer): void;
	onInactive?(session: CodexRealtimeConversation, error: Error, resuming: boolean): void;
	onStatus?(status: string): void;
}

export interface VoiceControllerRuntime {
	state: VoiceState;
	context?: ExtensionContext | undefined;
	config?: CodexConversionConfig | undefined;
	announcedMode?: CodexVoiceMode | undefined;
	startGeneration: number;
	startAbortController?: AbortController | undefined;
	voiceStatus: string;
	inputTooQuiet: boolean;
	realtimePeerPlan?: RealtimePeerPlan | undefined;
}

export async function startControllerMode(options: {
	runtime: VoiceControllerRuntime;
	messages: CodexVoiceSessionMessages;
	ctx: ExtensionContext;
	config: CodexConversionConfig;
	mode: CodexVoiceMode;
	realtimePeerPlan?: RealtimePeerPlan | undefined;
	resume?: boolean | undefined;
	inputMuted?: boolean | undefined;
	signal?: AbortSignal | undefined;
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined;
	stopCurrent(): Promise<void>;
	finishCurrentDictation(): Promise<void>;
	onError(error: Error, session?: CodexRealtimeConversation | undefined): void;
	onDrop(session: CodexRealtimeConversation, error: Error): void;
	onStatus(status: string): void;
}): Promise<CodexRealtimeConversation | undefined> {
	const { runtime, signal } = options;
	if (signal?.aborted) return;
	const realtimePrompt =
		options.mode === "realtime"
			? options.prepareRealtimePrompt(options.ctx)
			: undefined;
	if (options.mode === "realtime" && realtimePrompt === undefined) return;
	if (!options.resume) {
		if (runtime.state.type === "dictation")
			await options.finishCurrentDictation();
		else await options.stopCurrent();
	} else if (runtime.state.type !== "reconnecting") return;
	if (signal?.aborted) return;
	const startAbortController = new AbortController();
	runtime.startAbortController = startAbortController;
	const startSignal = signal
		? AbortSignal.any([signal, startAbortController.signal])
		: startAbortController.signal;
	const startGeneration = ++runtime.startGeneration;
	runtime.context = options.ctx;
	runtime.config = options.config;
	runtime.realtimePeerPlan = options.mode === "realtime" ? options.realtimePeerPlan : undefined;
	options.messages.setContext(options.ctx);
	runtime.state =
		options.mode === "realtime"
			? { type: "connecting", mode: "realtime", phase: "authorizing" }
			: { type: "connecting", mode: "dictation", phase: "authorizing" };
	const setStartupStatus = (status: string) => {
		if (
			startGeneration !== runtime.startGeneration ||
			runtime.startAbortController !== startAbortController ||
			runtime.state.type !== "connecting"
		) return;
		options.onStatus(status);
		options.realtimePeerPlan?.onStatus?.(status);
	};
	setStartupStatus("connecting…");
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
							onSummaryStatus: (active) => {
								setStartupStatus(active ? "summarizing…" : "connecting…");
							},
							signal: startSignal,
						})
					: Promise.resolve(undefined),
			]),
			startSignal,
		);
		if (startup === CANCELLED) {
			cancelStart(runtime, startGeneration);
			return;
		}
		const [auth, initialItems] = startup;
		if (
			startGeneration !== runtime.startGeneration ||
			runtime.state.type !== "connecting"
		) return;
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
			await currentVoiceSession(runtime.state)?.close();
			cancelStart(runtime, startGeneration);
			return;
		}
		const activeState = snapshotState(runtime);
		if (options.mode === "realtime") {
			if (activeState.type !== "conversation") {
				return;
			}
			if (realtimeSummary) options.messages.contextSummary(realtimeSummary);
			if (runtime.announcedMode !== options.mode) {
				runtime.announcedMode = options.mode;
				options.messages.modeStarted(options.mode);
			}
			return activeState.session;
		}
		if (activeState.type !== "dictation") return;
		runtime.announcedMode = options.mode;
		options.messages.modeStarted(options.mode);
		return undefined;
	} catch (error) {
		if (startSignal.aborted) {
			await currentVoiceSession(runtime.state)?.close();
			cancelStart(runtime, startGeneration);
			return;
		}
		if (startGeneration !== runtime.startGeneration) return;
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
	const peer = options.realtimePeerPlan?.createPeer();
	await startControllerConversation({
		auth,
		config: options.config,
		instructions,
		initialItems,
		inputMuted: options.inputMuted,
		greeting: options.resume
			? undefined
			: initialItems?.length
				? "contextual"
				: "fresh",
		peer,
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
				if (peer) options.realtimePeerPlan?.onActive?.(session, peer);
			},
			onError: (session, error) => {
				if (currentVoiceSession(runtime.state) === session)
					options.onError(error, session);
			},
			onDrop: (session, error) => {
				if (currentVoiceSession(runtime.state) === session)
					options.onDrop(session, error);
			},
			onStatus: options.onStatus,
			onTurn: (turn) => { void options.messages.voiceTurn(turn); },
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
	runtime.realtimePeerPlan = undefined;
	runtime.voiceStatus = "";
	runtime.inputTooQuiet = false;
	runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
}

function snapshotState(runtime: VoiceControllerRuntime): VoiceState {
	return runtime.state;
}
