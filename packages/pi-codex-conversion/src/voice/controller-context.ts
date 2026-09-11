import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { renderVoiceStartupContext } from "./context.ts";
import {
	prepareControllerRealtimeContext,
	type PreparedRealtimeContext,
	type RealtimePeerPlan,
	type VoiceControllerRuntime,
} from "./controller-start.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import {
	REALTIME_EVENT_ENTRY_TYPE,
	REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
} from "./message-types.ts";

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
	private readonly runtime: VoiceControllerRuntime;
	private readonly callbacks: RealtimeContextRefreshCallbacks;
	private abortController: AbortController | undefined;

	constructor(
		runtime: VoiceControllerRuntime,
		callbacks: RealtimeContextRefreshCallbacks,
	) {
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
		const voiceLeafId = ctx.sessionManager.getLeafId();
		const sessionId = ctx.sessionManager.getSessionId();
		const plan = this.runtime.realtimePeerPlan;
		const abortController = new AbortController();
		this.abortController = abortController;
		const signal = options.signal ? AbortSignal.any([options.signal, abortController.signal]) : abortController.signal;
		const releaseDelegations = this.callbacks.holdDelegations();
		try {
			const prepared = await prepareControllerRealtimeContext({
				ctx,
				config,
				signal,
				sourceLeafId: options.sourceLeafId,
				forceSummary: true,
			});
			// Finish accepted speech on the old call, including its delegation decision.
			if (prepared.summary) await previous.waitForInput(signal);
			if (
				signal.aborted ||
				ctx.sessionManager.getSessionId() !== sessionId ||
				!this.isCurrent(previous, generation, abortController)
			)
				return;
			if (!prepared.summary || conversationLeafId(ctx) !== leafId) {
				ctx.ui.notify("Voice context refresh skipped because the conversation was empty or changed while summarizing. Keeping the current call.", "warning");
				return;
			}
			const tail = voiceContextSince(ctx, voiceLeafId);
			if (tail) {
				prepared.initialItems?.push({
					type: "message",
					role: "developer",
					content: [{ type: "input_text", text: renderVoiceStartupContext(tail) }],
				});
			}
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
	// Voice arrivals are carried after the summary, not grounds to discard it.
	return ctx.sessionManager.getBranch().findLast(
		(entry) => entry.type !== "custom" || (
			entry.customType !== REALTIME_EVENT_ENTRY_TYPE &&
			entry.customType !== REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE &&
			entry.customType !== REALTIME_VOICE_MESSAGE_TYPE
		),
	)?.id;
}

function voiceContextSince(ctx: ExtensionContext, leafId: string | null): string {
	const branch = ctx.sessionManager.getBranch();
	const tail = branch.slice(branch.findIndex((entry) => entry.id === leafId) + 1);
	return tail.flatMap((entry) => {
		if (entry.type !== "custom" || !entry.data || typeof entry.data !== "object") return [];
		if (
			entry.customType === REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE &&
			"transcript" in entry.data && typeof entry.data.transcript === "string"
		)
			return [`user: ${entry.data.transcript}`];
		if (
			entry.customType === REALTIME_VOICE_MESSAGE_TYPE &&
			"input" in entry.data && typeof entry.data.input === "string"
		)
			return [`assistant: ${entry.data.input}`];
		return [];
	}).join("\n");
}
