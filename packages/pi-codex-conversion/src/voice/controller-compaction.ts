import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import {
	prepareControllerRealtimeContext,
	type PreparedRealtimeContext,
	type RealtimePeerPlan,
	type VoiceControllerRuntime,
} from "./controller-start.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";

interface RealtimeCompactionRefreshCallbacks {
	inputMuted(): boolean;
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

export class RealtimeCompactionRefresh {
	private readonly runtime: VoiceControllerRuntime;
	private readonly callbacks: RealtimeCompactionRefreshCallbacks;
	private abortController: AbortController | undefined;

	constructor(
		runtime: VoiceControllerRuntime,
		callbacks: RealtimeCompactionRefreshCallbacks,
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
	): Promise<void> {
		const activeState = this.runtime.state;
		if (
			!config.voice.refreshRealtimeAfterCompaction ||
			activeState.type !== "conversation" ||
			this.runtime.announcedMode !== "realtime"
		)
			return;
		this.cancel();
		if (!config.voice.contextModel) {
			ctx.ui.notify(
				"Realtime voice compaction refresh needs a Voice context model; keeping the current call",
				"warning",
			);
			return;
		}
		const previous = activeState.session;
		const generation = this.runtime.startGeneration;
		const leafId = ctx.sessionManager.getLeafId();
		const plan = this.runtime.realtimePeerPlan;
		const abortController = new AbortController();
		this.abortController = abortController;
		try {
			const prepared = await prepareControllerRealtimeContext({
				ctx,
				config,
				signal: abortController.signal,
			});
			if (
				!prepared.summary ||
				ctx.sessionManager.getLeafId() !== leafId ||
				!this.isCurrent(previous, generation, abortController)
			)
				return;
			await this.callbacks.replace(
				ctx,
				config,
				previous,
				plan,
				this.callbacks.inputMuted(),
				prepared,
				abortController.signal,
			);
		} catch (error) {
			if (!abortController.signal.aborted)
				ctx.ui.notify(
					"Could not refresh realtime voice after compaction: " +
						(error instanceof Error ? error.message : String(error)),
					"warning",
				);
		} finally {
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
