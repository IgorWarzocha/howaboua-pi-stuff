import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ActiveVoiceGuard } from "./active-owner.ts";
import type { RealtimeAudio } from "./audio.ts";
import { GrokAgentOutput } from "./call/agent-output.ts";
import { asError, GrokCall } from "./call/lifecycle.ts";
import type { GrokRealtimeConfig } from "./config.ts";
import { prepareContext } from "./context.ts";
import { GrokControllerHandoff } from "./controller/handoff.ts";
import { resolveConnection } from "./credentials.ts";
import { loadVoicePrompt } from "./system-prompt.ts";
import { collectGrokTools } from "./tools.ts";

export type PreparedVoice = Awaited<
	ReturnType<GrokRealtimeController["prepareHandoff"]>
>;

export class GrokRealtimeController {
	private call: GrokCall | undefined;
	private status = "idle";
	private readonly output = new GrokAgentOutput(() => this.call?.session);
	private operation = Promise.resolve();
	private generation = 0;
	private readonly handoff: GrokControllerHandoff;
	onChange: (() => void) | undefined;
	onTransferredEvent: ((event: string, data: unknown) => void) | undefined;
	onHandoffState:
		| ((state: ReturnType<GrokRealtimeController["state"]>) => void)
		| undefined;
	private readonly pi: ExtensionAPI;
	private readonly ownership: ActiveVoiceGuard;
	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		this.ownership = new ActiveVoiceGuard(pi, "Grok", () =>
			Boolean(this.call || this.handoff.preparing || this.handoff.controls),
		);
		this.handoff = new GrokControllerHandoff({
			currentCall: () => this.call,
			releaseCall: () => {
				this.call = undefined;
			},
			assertAvailable: () => this.ownership.assertAvailable(),
			setStatus: (status) => this.setStatus(status),
			enqueue: (action) => this.enqueue(action),
			lifecycle: (ctx, state) => this.lifecycle(ctx, state),
			transferredEvent: (event, data) => this.onTransferredEvent?.(event, data),
			changed: () => this.onChange?.(),
		});
	}
	state(): { status: string; muted: boolean; piBusy: boolean } {
		return {
			status: this.status,
			muted: this.call?.muted ?? this.handoff.controls?.inputMuted ?? false,
			piBusy:
				this.call?.piBusy ??
				(this.handoff.controls ? this.handoff.busy : false),
		};
	}

	reserveHandoffArrival(): { signal: AbortSignal; release(): void } {
		return this.handoff.reserveHandoffArrival();
	}
	async prepareHandoff(
		ctx: ExtensionContext,
		config: GrokRealtimeConfig,
		signal: AbortSignal,
	) {
		const tools = collectGrokTools(this.pi);
		if (
			config.webSearch &&
			tools.definitions.some((tool) => tool.name === "web_search")
		)
			throw new Error(
				"A local tool uses web_search. Rename it or disable native Web search before starting voice",
			);
		const instructions = loadVoicePrompt(ctx.cwd);
		const [context, connection] = await Promise.all([
			prepareContext(ctx, config, signal),
			resolveConnection(ctx, config.model, config.access, signal),
		]);
		signal.throwIfAborted();
		return { tools, instructions, context, connection };
	}
	captureHandoffAudio() {
		return this.handoff.captureHandoffAudio();
	}
	get transferred(): boolean {
		return Boolean(this.handoff.controls);
	}
	startTransferredCall(): Promise<void> {
		const controls = this.handoff.controls;
		if (!controls)
			return Promise.reject(new Error("Selected voice connection closed"));
		return controls.startCall();
	}
	stopCall(): Promise<void> {
		return this.handoff.controls?.stopCall() ?? this.stop();
	}
	async sendText(ctx: ExtensionContext, text: string): Promise<void> {
		if (this.handoff.controls) return this.handoff.controls.sendText(text);
		this.input(text);
		this.pi.sendUserMessage(
			text,
			ctx.isIdle() ? undefined : { deliverAs: "steer" },
		);
	}
	stopWithAudio(audio: RealtimeAudio): Promise<void> {
		if (this.call?.audio !== audio) return Promise.resolve();
		return this.stop();
	}

	start(
		ctx: ExtensionContext,
		config: GrokRealtimeConfig,
		audio: RealtimeAudio,
		arrival?: {
			prepared: PreparedVoice;
			alternateVoice: boolean;
			inputMuted: boolean;
			signal: AbortSignal;
		},
	): Promise<void> {
		if (!arrival) this.cancelStartup();
		const generation = ++this.generation;
		return this.ownership.start(() =>
			this.enqueue(async () => {
				await this.stopCurrent(Boolean(arrival));
				if (generation !== this.generation)
					throw new Error("Voice startup cancelled");
				arrival?.signal.throwIfAborted();
				if (arrival?.alternateVoice)
					config = { ...config, voice: config.alternateVoice };
				const tools = arrival?.prepared.tools ?? collectGrokTools(this.pi);
				if (
					config.webSearch &&
					tools.definitions.some((tool) => tool.name === "web_search")
				)
					throw new Error(
						"A local tool uses web_search. Rename it or disable native Web search before starting voice",
					);
				const call = new GrokCall(
					this.pi,
					ctx,
					config,
					audio,
					tools,
					{
						isCurrent: () => this.call === call,
						working: () => this.working(),
						status: (status) => this.setStatus(status),
						stop: () => this.stop(),
						lifecycle: (ctx, state) => this.lifecycle(ctx, state),
					},
					arrival?.alternateVoice ?? false,
				);
				this.call = call;
				this.setStatus("connecting");
				try {
					await call.start(arrival);
				} catch (error) {
					await this.stopCurrent();
					throw error;
				}
			}),
		);
	}

	stop(): Promise<void> {
		this.generation++;
		this.handoff.cancelReservation();
		this.call?.abort.abort();
		return this.enqueue(() => this.stopCurrent());
	}
	cancelStartup(): void {
		this.generation++;
		this.handoff.cancelReservation();
		if (this.call && (!this.call.announced || this.call.reconnecting))
			this.call.abort.abort();
	}
	mute(muted: boolean): void {
		if (this.handoff.controls) {
			this.handoff.controls.setInputMuted(muted);
			this.publishState();
			return;
		}
		const call = this.call;
		if (!call) return;
		call.diagnostic({ type: "microphone.muted", muted });
		call.audio.setMuted(muted);
		call.session.setMuted(muted);
		call.muted = muted;
		this.publishState();
	}
	input(text: string): void {
		const call = this.call;
		if (!call) return;
		this.working();
		call.session.context(
			`Already delivered to Pi, do not call send_task for this:\n${text}`,
			false,
		);
	}
	working(): void {
		const call = this.call;
		if (!call) return;
		call.piBusy = true;
		call.session.setPiBusy(true);
		this.publishState();
	}
	messageStarted(): void {
		this.output.messageStarted();
	}
	stream(message: AssistantMessage): void {
		this.output.stream(message);
	}
	message(message: AssistantMessage): void {
		this.output.message(message);
	}

	settled(): void {
		const call = this.call;
		if (call) call.piBusy = false;
		call?.session.setPiBusy(false);
		this.publishState();
	}
	async compacted(ctx: ExtensionContext): Promise<void> {
		const call = this.call;
		if (!call) return;
		try {
			const summary = await prepareContext(ctx, call.config, call.abort.signal);
			if (this.call !== call || call.abort.signal.aborted || !summary) return;
			this.pi.appendEntry("grok-realtime-context", { text: summary });
			call.session.context(
				`Updated Pi continuity summary after compaction, background only:\n${summary}`,
				false,
			);
		} catch (error) {
			if (this.call === call && !call.abort.signal.aborted)
				ctx.ui.notify(
					`Voice context refresh failed; current call retained: ${asError(error).message}`,
					"warning",
				);
		}
	}

	private async stopCurrent(preserveTransferred = false): Promise<void> {
		return this.ownership.hold(async () => {
			const transferred = this.handoff.takeTransferred();
			if (!preserveTransferred) await transferred?.stop();
			const call = this.call;
			this.call = undefined;
			this.setStatus("idle");
			if (!call) return;
			await call.close();
		});
	}
	private lifecycle(ctx: ExtensionContext, state: "started" | "ended"): void {
		if (state === "ended") ctx.ui.setStatus("grok-realtime", undefined);
		else this.publishState();
		this.pi.appendEntry("grok-realtime-lifecycle", { state });
	}
	private setStatus(status: string): void {
		if (this.status === status) return;
		this.status = status;
		this.publishState();
	}
	private publishState(): void {
		const call = this.call;
		call?.ctx.ui.setStatus(
			"grok-realtime",
			`Grok: ${this.status}${call.piBusy ? " · Pi working" : ""}${call.muted ? " · mic muted" : ""}`,
		);
		this.onChange?.();
		this.onHandoffState?.(this.state());
	}
	private enqueue(action: () => Promise<void>): Promise<void> {
		const result = this.operation.then(action, action);
		this.operation = result.catch(() => {});
		return result;
	}
}
