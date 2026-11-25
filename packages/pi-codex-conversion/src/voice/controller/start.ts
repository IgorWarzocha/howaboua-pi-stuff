import { resolveRealtimeVoiceAuth } from "../realtime-auth.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "../auth.ts";
import { CANCELLED, interruptible } from "../cancellation.ts";
import {
	priorVoiceCallHistory,
	type VoiceCallContext,
} from "../call-context.ts";
import {
	buildRealtimeInitialItems,
	type RealtimeInitialMessageItem,
} from "../context.ts";
import {
	startControllerConversation,
	startControllerDictation,
} from "./sessions.ts";
import {
	currentVoiceSession,
	VOICE_STATUS_KEY,
	type VoiceState,
} from "./support.ts";
import type { RealtimePeer } from "../conversation/peer.ts";
import type { TransferredVoiceControls } from "../handoff-contract.ts";
import type { RealtimeConversation } from "../conversation/session.ts";
import type { CodexVoiceSessionMessages } from "../session-messages.ts";
import type { CodexVoiceMode } from "../ui.ts";

export interface RealtimePeerPlan {
	createPeer(): RealtimePeer;
	onActive?(session: RealtimeConversation, peer: RealtimePeer): void;
	onInactive?(
		session: RealtimeConversation,
		error: Error,
		resuming: boolean,
	): void;
	onStatus?(status: string): void;
	onTransferred?(peer: RealtimePeer, controls: TransferredVoiceControls): void;
	onTransferEnded?(peer: RealtimePeer, error?: Error): void;
	onStopped?(): void;
}

export interface VoiceControllerRuntime {
	state: VoiceState;
	alternateVoice?: boolean;
	context?: ExtensionContext | undefined;
	config?: CodexConversionConfig | undefined;
	announcedMode?: CodexVoiceMode | undefined;
	startGeneration: number;
	startAbortController?: AbortController | undefined;
	voiceStatus: string;
	inputTooQuiet: boolean;
	realtimePeerPlan?: RealtimePeerPlan | undefined;
	voiceCallContext?: VoiceCallContext | undefined;
}

export interface PreparedRealtimeContext {
	initialItems: RealtimeInitialMessageItem[] | undefined;
	summary?: string | undefined;
	refreshCursor?: Omit<VoiceCallContext, "summary"> | undefined;
}

export async function prepareControllerRealtimeContext(options: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	config: CodexConversionConfig;
	signal?: AbortSignal | undefined;
	onSummaryStatus?: ((active: boolean) => void) | undefined;
	sourceLeafId?: string | undefined;
	forceSummary?: boolean | undefined;
	priorVoiceHistory?: string | undefined;
}): Promise<PreparedRealtimeContext> {
	let summary: string | undefined;
	const initialItems = await buildRealtimeInitialItems({
		pi: options.pi,
		ctx: options.ctx,
		config: options.config,
		sourceLeafId: options.sourceLeafId,
		forceSummary: options.forceSummary,
		priorVoiceHistory: options.priorVoiceHistory,
		onSummarySelected: (value) => {
			summary = value;
		},
		...(options.signal ? { signal: options.signal } : {}),
		...(options.onSummaryStatus
			? { onSummaryStatus: options.onSummaryStatus }
			: {}),
	});
	return {
		initialItems,
		...(summary ? { summary } : {}),
	};
}

export async function startControllerMode(options: {
	pi: ExtensionAPI;
	runtime: VoiceControllerRuntime;
	messages: CodexVoiceSessionMessages;
	ctx: ExtensionContext;
	config: CodexConversionConfig;
	mode: CodexVoiceMode;
	realtimePeerPlan?: RealtimePeerPlan | undefined;
	resume?: boolean | undefined;
	alternateVoice?: boolean | undefined;
	inputMuted?: boolean | undefined;
	preparedRealtimeContext?: PreparedRealtimeContext | undefined;
	signal?: AbortSignal | undefined;
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined;
	stopCurrent(): Promise<void>;
	finishCurrentDictation(): Promise<void>;
	onError(error: Error, session?: RealtimeConversation | undefined): void;
	onEndCall(session: RealtimeConversation): void;
	onDrop(session: RealtimeConversation, error: Error): void;
	onStatus(status: string): void;
}): Promise<RealtimeConversation | undefined> {
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
	runtime.alternateVoice = options.resume
		? (runtime.alternateVoice ?? false)
		: (options.alternateVoice ?? false);
	runtime.realtimePeerPlan =
		options.mode === "realtime" ? options.realtimePeerPlan : undefined;
	// Only a prepared refresh preserves the existing call's queued Pi work.
	if (!options.resume || !options.preparedRealtimeContext)
		options.messages.setContext(options.ctx);
	const voiceCursor =
		options.mode === "realtime"
			? (options.preparedRealtimeContext?.refreshCursor ?? {
					sessionId: options.ctx.sessionManager.getSessionId(),
					through: options.ctx.sessionManager.getLeafId(),
				})
			: undefined;
	const droppedCall =
		options.resume &&
		!options.preparedRealtimeContext &&
		runtime.voiceCallContext?.sessionId === voiceCursor?.sessionId
			? runtime.voiceCallContext
			: undefined;
	const voiceScope = droppedCall ?? voiceCursor;
	runtime.voiceCallContext = voiceScope;
	runtime.state =
		options.mode === "realtime"
			? { type: "connecting", mode: "realtime", phase: "authorizing" }
			: { type: "connecting", mode: "dictation", phase: "authorizing" };
	const setStartupStatus = (status: string) => {
		if (
			startGeneration !== runtime.startGeneration ||
			runtime.startAbortController !== startAbortController ||
			runtime.state.type !== "connecting"
		)
			return;
		options.onStatus(status);
		options.realtimePeerPlan?.onStatus?.(status);
	};
	setStartupStatus("connecting…");
	try {
		const priorVoiceHistory = droppedCall
			? priorVoiceCallHistory(
					droppedCall,
					options.ctx.sessionManager.getSessionId(),
					options.ctx.sessionManager.getBranch(),
				)
			: undefined;
		const startup = await interruptible(
			Promise.all([
				options.mode === "realtime"
					? resolveRealtimeVoiceAuth(options.ctx, options.config, options.pi)
					: resolveCodexVoiceAuth(options.ctx),
				options.mode === "realtime"
					? options.preparedRealtimeContext
						? Promise.resolve(options.preparedRealtimeContext)
						: prepareControllerRealtimeContext({
								pi: options.pi,
								ctx: options.ctx,
								config: options.config,
								priorVoiceHistory,
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
		const [auth, realtimeContext] = startup;
		if (
			startGeneration !== runtime.startGeneration ||
			runtime.state.type !== "connecting"
		)
			return;
		if (
			(options.preparedRealtimeContext?.refreshCursor || droppedCall) &&
			runtime.voiceCallContext !== voiceScope
		)
			throw new Error("Conversation changed while reconnecting voice");
		if (options.mode === "dictation") await startDictation(options, auth);
		else
			await startConversation(
				options,
				auth,
				realtimePrompt!,
				realtimeContext?.initialItems,
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
			if (
				voiceCursor &&
				runtime.voiceCallContext === voiceScope &&
				realtimeContext?.summary
			) {
				runtime.voiceCallContext = {
					...voiceCursor,
					summary: realtimeContext.summary,
				};
				options.messages.contextSummary(realtimeContext.summary);
			}
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
		ctx: options.ctx,
		auth,
		config: runtime.alternateVoice
			? {
					...options.config,
					voice: {
						...options.config.voice,
						v3Voice: options.config.voice.v3AlternateVoice,
						realtimeVoice: options.config.voice.realtimeAlternateVoice,
					},
				}
			: options.config,
		instructions,
		initialItems,
		inputMuted: options.inputMuted,
		greeting: options.resume
			? undefined
			: options.alternateVoice !== undefined
				? "handoff"
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
				// Startup is asynchronous. Sample current work, not the turn that
				// was active before auth, context preparation, and peer setup.
				if (!options.ctx.isIdle()) session.agentTurn.agentStarted();
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
			onEndCall: options.onEndCall,
			onTurn: (session, turn) => {
				void options.messages.voiceTurn(turn, session);
			},
			onEvent: (event) => options.messages.realtimeEvent(event),
			onUserTranscript: (transcript) =>
				options.messages.userTranscript(transcript),
			onAudioDiagnostics: (diagnostics) =>
				options.messages.audioDiagnostics(diagnostics),
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
	runtime.voiceCallContext = undefined;
	runtime.voiceStatus = "";
	runtime.inputTooQuiet = false;
	runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
}

function snapshotState(runtime: VoiceControllerRuntime): VoiceState {
	return runtime.state;
}
