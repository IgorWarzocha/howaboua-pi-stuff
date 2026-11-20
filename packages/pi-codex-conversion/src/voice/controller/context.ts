import { markRealtimePeerInactive } from "./reconnect.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import {
	priorVoiceCallHistory,
	voiceTranscriptSince,
} from "../call-context.ts";
import {
	prepareControllerRealtimeContext,
	type PreparedRealtimeContext,
	type RealtimePeerPlan,
	type VoiceControllerRuntime,
} from "./start.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";

export interface RealtimeContextRefreshOptions {
	sourceLeafId?: string | undefined;
	signal?: AbortSignal | undefined;
}

interface RealtimeContextRefreshCallbacks {
	inputMuted(): boolean;
	holdDelegations(): () => void;
	replace(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		previous: CodexRealtimeConversation,
		plan: RealtimePeerPlan | undefined,
		inputMuted: boolean,
		prepared: PreparedRealtimeContext,
		signal: AbortSignal,
	): Promise<void>;
}

export class RealtimeContextRefresh {
	private readonly pi: ExtensionAPI;
	private readonly runtime: VoiceControllerRuntime;
	private readonly callbacks: RealtimeContextRefreshCallbacks;
	private abortController: AbortController | undefined;

	constructor(
		pi: ExtensionAPI,
		runtime: VoiceControllerRuntime,
		callbacks: RealtimeContextRefreshCallbacks,
	) {
		this.pi = pi;
		this.runtime = runtime;
		this.callbacks = callbacks;
	}

	cancel(): void {
		this.abortController?.abort();
		this.abortController = undefined;
	}

	async run(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		options: RealtimeContextRefreshOptions = {},
	): Promise<void> {
		const activeState = this.runtime.state;
		if (
			options.signal?.aborted ||
			!config.voice.refreshRealtimeAfterCompaction ||
			activeState.type !== "conversation" ||
			activeState.session.isEndingCall ||
			this.runtime.announcedMode !== "realtime"
		)
			return;
		this.cancel();
		if (!config.voice.contextModel) {
			ctx.ui.notify(
				"Realtime voice context refresh needs a Voice context model. Keeping the current call.",
				"warning",
			);
			return;
		}
		const previous = activeState.session;
		const generation = this.runtime.startGeneration;
		const leafId = conversationLeafId(ctx);
		const sessionId = ctx.sessionManager.getSessionId();
		const call = this.runtime.voiceCallContext;
		const sourceBranch = ctx.sessionManager.getBranch(options.sourceLeafId);
		const through = sourceBranch.at(-1)?.id ?? null;
		const plan = this.runtime.realtimePeerPlan;
		const abortController = new AbortController();
		this.abortController = abortController;
		const signal = options.signal
			? AbortSignal.any([options.signal, abortController.signal])
			: abortController.signal;
		const releaseDelegations = this.callbacks.holdDelegations();
		try {
			const prepared = await prepareControllerRealtimeContext({
				pi: this.pi,
				ctx,
				config,
				signal,
				sourceLeafId: options.sourceLeafId,
				forceSummary: true,
				priorVoiceHistory: priorVoiceCallHistory(call, sessionId, sourceBranch),
			});
			if (prepared.summary) await previous.waitForRefreshBoundary(signal);
			if (
				signal.aborted ||
				ctx.sessionManager.getSessionId() !== sessionId ||
				this.runtime.voiceCallContext !== call ||
				!this.isCurrent(previous, generation, abortController)
			)
				return;
			if (!prepared.summary || conversationLeafId(ctx) !== leafId) {
				ctx.ui.notify(
					"Voice context refresh skipped because the conversation was empty or changed while summarizing. Keeping the current call.",
					"warning",
				);
				return;
			}
			prepared.refreshCursor = { sessionId, through };
			await this.callbacks.replace(
				ctx,
				config,
				previous,
				plan,
				this.callbacks.inputMuted(),
				prepared,
				// Once the old call closes, finish replacement unless voice itself stops.
				abortController.signal,
			);
		} catch (error) {
			if (!signal.aborted)
				ctx.ui.notify(
					"Could not refresh realtime voice context: " +
						(error instanceof Error ? error.message : String(error)),
					"warning",
				);
		} finally {
			releaseDelegations();
			if (this.abortController === abortController)
				this.abortController = undefined;
		}
	}

	private isCurrent(
		session: CodexRealtimeConversation,
		generation: number,
		abortController: AbortController,
	): boolean {
		return (
			!abortController.signal.aborted &&
			this.abortController === abortController &&
			this.runtime.startGeneration === generation &&
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session === session
		);
	}
}

function conversationLeafId(ctx: ExtensionContext): string | undefined {
	// Raw captions and diagnostics don't change projected Pi conversation.
	return ctx.sessionManager
		.getBranch()
		.findLast((entry) => entry.type !== "custom")?.id;
}

interface ContextReplacementCallbacks {
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined;
	renderStatus(status: string): void;
	fail(error: Error, previous: CodexRealtimeConversation): void;
	startReplacement(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		plan: RealtimePeerPlan | undefined,
		inputMuted: boolean,
		prepared: PreparedRealtimeContext,
		signal: AbortSignal,
	): Promise<CodexRealtimeConversation | undefined>;
}
export async function replaceRealtimeContext({
	runtime,
	callbacks,
	ctx,
	config,
	previous,
	plan,
	inputMuted,
	prepared,
	signal,
}: {
	runtime: VoiceControllerRuntime;
	callbacks: ContextReplacementCallbacks;
	ctx: ExtensionContext;
	config: CodexConversionConfig;
	previous: CodexRealtimeConversation;
	plan: RealtimePeerPlan | undefined;
	inputMuted: boolean;
	prepared: PreparedRealtimeContext;
	signal: AbortSignal;
}): Promise<void> {
	if (!callbacks.prepareRealtimePrompt(ctx))
		throw new Error("Realtime voice prompt is unavailable");
	const call = runtime.voiceCallContext;
	markRealtimePeerInactive(
		runtime,
		previous,
		new Error("Realtime voice refreshed for a new context"),
		true,
		plan,
	);
	runtime.startAbortController?.abort();
	runtime.startAbortController = undefined;
	const generation = ++runtime.startGeneration;
	runtime.state = { type: "reconnecting", session: previous };
	callbacks.renderStatus("reconnecting…");
	plan?.onStatus?.("reconnecting…");
	try {
		await previous.close();
	} catch (error) {
		callbacks.fail(
			error instanceof Error ? error : new Error(String(error)),
			previous,
		);
		return;
	}
	if (
		signal.aborted ||
		runtime.startGeneration !== generation ||
		runtime.state.type !== "reconnecting"
	)
		return;
	const cursor = prepared.refreshCursor;
	const tail =
		runtime.voiceCallContext === call &&
		cursor?.sessionId === ctx.sessionManager.getSessionId()
			? voiceTranscriptSince(ctx.sessionManager.getBranch(), cursor.through)
			: undefined;
	if (tail === undefined) {
		callbacks.fail(
			new Error("Conversation changed while reconnecting voice"),
			previous,
		);
		return;
	}
	// Closing can flush a final caption. This tail wasn't covered by the summary.
	if (tail)
		prepared.initialItems?.push({
			type: "message",
			role: "developer",
			content: [
				{
					type: "input_text",
					text: `Voice conversation after the summary snapshot. Use as background.\n\n${tail}`,
				},
			],
		});
	const replacement = await callbacks.startReplacement(
		ctx,
		config,
		plan,
		inputMuted,
		prepared,
		signal,
	);
	if (!replacement && !signal.aborted && runtime.state.type === "reconnecting")
		callbacks.fail(
			new Error("Codex realtime voice could not refresh"),
			previous,
		);
}
