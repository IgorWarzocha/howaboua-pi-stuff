import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ActiveVoiceGuard } from "./active-owner.ts";
import type { RealtimeAudio } from "./audio.ts";
import type { GrokRealtimeConfig } from "./config.ts";
import { prepareContext } from "./context.ts";
import { resolveConnection } from "./credentials.ts";
import { completedVoiceReasoningSummary } from "./reasoning-summary.ts";
import { GrokSession } from "./session.ts";
import { loadVoicePrompt } from "./system-prompt.ts";
import type { GrokToolWireDefinition } from "./tools.ts";
import { collectGrokTools } from "./tools.ts";

type Call = {
	abort: AbortController;
	audio: RealtimeAudio;
	session: GrokSession;
	ctx: ExtensionContext;
	config: GrokRealtimeConfig;
	muted: boolean;
	piBusy: boolean;
	announced: boolean;
	endGeneration: number;
	playbackGeneration: number;
	reconnecting: boolean;
	instructions: string;
	tools: readonly GrokToolWireDefinition[];
	createSession(): GrokSession;
	diagnostic(event: Record<string, unknown>): void;
};

export class GrokRealtimeController {
	private call: Call | undefined;
	private status = "idle";
	private forwardedText = 0;
	private operation = Promise.resolve();
	onChange: (() => void) | undefined;
	private readonly pi: ExtensionAPI;
	private readonly ownership: ActiveVoiceGuard;
	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		this.ownership = new ActiveVoiceGuard(pi, "Grok", () => Boolean(this.call));
	}
	state(): { status: string; muted: boolean; piBusy: boolean } {
		return {
			status: this.status,
			muted: this.call?.muted ?? false,
			piBusy: this.call?.piBusy ?? false,
		};
	}

	start(
		ctx: ExtensionContext,
		config: GrokRealtimeConfig,
		audio: RealtimeAudio,
	): Promise<void> {
		this.cancelStartup();
		return this.enqueue(() =>
			this.ownership.start(async () => {
				await this.stopCurrent();
				const abort = new AbortController();
				const tools = collectGrokTools(this.pi);
				if (
					config.webSearch &&
					tools.definitions.some((tool) => tool.name === "web_search")
				)
					throw new Error(
						"A local tool uses web_search. Rename it or disable native Web search before starting voice",
					);
				let call!: Call;
				const callId = crypto.randomUUID();
				const diagnostic = (event: Record<string, unknown>) =>
					this.pi.appendEntry("grok-realtime-diagnostic", { callId, ...event });
				diagnostic({ type: "call.start", mode: audio.constructor.name });
				const createSession = () =>
					new GrokSession({
						diagnostic,
						nativeTool: (id, name, args) =>
							this.pi.appendEntry("grok-realtime-native-tool", {
								id,
								name,
								args,
							}),
						executeTool: (name, args, callId) =>
							tools.execute(name, args, { signal: abort.signal, ctx, callId }),
						audio: (pcm) => {
							if (this.call === call) audio.play(pcm);
						},
						audioDone: (responseId) => {
							// Mark the final render boundary for playback completion.
							const generation = call.playbackGeneration;
							return audio.drain().then(() =>
								diagnostic({
									response_id: responseId,
									type:
										generation === call.playbackGeneration && this.call === call
											? "playback.drained"
											: "playback.drain_interrupted",
								}),
							);
						},
						interrupt: () => {
							diagnostic({ type: "playback.cleared" });
							call.endGeneration++;
							call.playbackGeneration++;
							audio.clear();
						},
						endCall: () => {
							void this.finishCall(call).catch((error) =>
								ctx.ui.notify(asError(error).message, "error"),
							);
						},
						transcript: (role, text) =>
							this.pi.appendEntry("grok-realtime-transcript", { role, text }),
						task: (id, request) => {
							if (this.call !== call)
								throw new Error(
									"Voice call ended before the task was accepted",
								);
							this.working();
							this.pi.appendEntry("grok-realtime-delegation", { id, request });
							this.pi.sendUserMessage(
								request,
								ctx.isIdle() ? undefined : { deliverAs: "steer" },
							);
						},
						status: (status) => {
							if (this.call === call) this.setStatus(status);
						},
						error: (error) => {
							diagnostic({ type: "call.error", message: error.message });
							if (this.call === call) {
								ctx.ui.notify(error.message, "error");
								void this.stop();
							}
						},
						disconnected: (error) => {
							if (this.call === call) void this.resume(call, error);
						},
					});
				const session = createSession();
				call = {
					abort,
					audio,
					session,
					ctx,
					config,
					muted: false,
					piBusy: !ctx.isIdle(),
					announced: false,
					endGeneration: 0,
					playbackGeneration: 0,
					reconnecting: false,
					instructions: "",
					tools: tools.definitions,
					createSession,
					diagnostic,
				};
				this.call = call;
				this.setStatus("connecting");
				try {
					const instructions = loadVoicePrompt(ctx.cwd);
					call.instructions = instructions;
					this.setStatus("summarizing");
					const context = await prepareContext(ctx, config, abort.signal);
					if (context)
						this.pi.appendEntry("grok-realtime-context", { text: context });
					this.setStatus("connecting");
					const connection = await resolveConnection(
						ctx,
						config.model,
						config.access,
						abort.signal,
					);
					if (abort.signal.aborted) throw new Error("Voice startup cancelled");
					const cancelAudio = () => {
						void audio.close();
					};
					abort.signal.addEventListener("abort", cancelAudio, { once: true });
					await audio.start({
						onAudio: (pcm) => {
							if (this.call !== call || call.muted) return;
							try {
								call.session.appendAudio(pcm);
							} catch (error) {
								ctx.ui.notify(asError(error).message, "error");
								void this.stop();
							}
						},
						onError: (error) => {
							if (this.call === call) {
								ctx.ui.notify(error.message, "error");
								void this.stop();
							}
						},
					});
					if (abort.signal.aborted) throw new Error("Voice startup cancelled");
					session.setPiBusy(!ctx.isIdle());
					await session.start(
						connection,
						config,
						context,
						abort.signal,
						tools.definitions,
						instructions,
					);
					this.lifecycle(ctx, "started");
					call.announced = true;
				} catch (error) {
					await this.stopCurrent();
					throw error;
				}
			}),
		);
	}

	stop(): Promise<void> {
		this.call?.abort.abort();
		return this.enqueue(() => this.stopCurrent());
	}
	cancelStartup(): void {
		if (this.call && (!this.call.announced || this.call.reconnecting))
			this.call.abort.abort();
	}
	mute(muted: boolean): void {
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
		this.forwardedText = 0;
	}
	stream(message: AssistantMessage): void {
		const call = this.call;
		if (!call) return;
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		for (;;) {
			const remaining = text.slice(this.forwardedText);
			const match = this.forwardedText
				? /\n\s*\n/.exec(remaining)
				: [...remaining.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)].filter(
						(end) => !/\d/.test(remaining[end.index - 1] ?? ""),
					)[1];
			if (!match || match.index === undefined) return;
			const boundary = match.index + match[0].length;
			if (!/[\p{L}\p{N}]/u.test(remaining.slice(boundary))) return;
			const update = remaining.slice(0, boundary).trim();
			this.forwardedText += boundary;
			if (update)
				call.session.context(
					`Pi assistant reply continuing; more may follow:\n${update}`,
				);
		}
	}
	message(message: AssistantMessage): void {
		const call = this.call;
		if (!call) return;
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		const tail = text.slice(this.forwardedText).trim();
		this.forwardedText = 0;
		if (!text.trim() && message.stopReason === "toolUse") {
			const summary = completedVoiceReasoningSummary(message);
			if (summary)
				call.session.context(
					`Pi progress summary, not a completed result:\n${summary}`,
				);
		}
		if (tail)
			call.session.context(
				`Pi assistant ${message.stopReason === "toolUse" ? "progress" : "reply"} ending:\n${tail}`,
			);
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

	private async resume(call: Call, error: Error): Promise<void> {
		if (this.call !== call || call.abort.signal.aborted || call.reconnecting)
			return;
		if (!call.config.autoResume) {
			call.ctx.ui.notify(
				`${error.message}; start a new call to reconnect`,
				"error",
			);
			await this.stop();
			return;
		}
		// Like GipPity, replace an established dropped session once, without a retry loop.
		call.reconnecting = true;
		try {
			call.endGeneration++;
			call.playbackGeneration++;
			call.session.close();
			call.audio.clear();
			call.session = call.createSession();
			call.session.setMuted(call.muted);
			call.session.setPiBusy(call.piBusy);
			this.setStatus("reconnecting");
			call.diagnostic({ type: "call.reconnecting", message: error.message });
			const context = await prepareContext(
				call.ctx,
				call.config,
				call.abort.signal,
			);
			if (context)
				this.pi.appendEntry("grok-realtime-context", { text: context });
			const connection = await resolveConnection(
				call.ctx,
				call.config.model,
				call.config.access,
				call.abort.signal,
			);
			if (this.call !== call || call.abort.signal.aborted) return;
			await call.session.start(
				connection,
				call.config,
				context,
				call.abort.signal,
				call.tools,
				call.instructions,
				true,
			);
			call.diagnostic({ type: "call.resumed" });
		} catch (resumeError) {
			if (this.call === call && !call.abort.signal.aborted) {
				call.ctx.ui.notify(
					`Grok voice could not resume: ${asError(resumeError).message}. Start a new call to reconnect`,
					"error",
				);
				await this.stop();
			}
		} finally {
			call.reconnecting = false;
		}
	}

	private async finishCall(call: Call): Promise<void> {
		if (this.call !== call) return;
		const generation = ++call.endGeneration;
		this.setStatus("ending");
		try {
			await call.audio.drain();
		} catch (error) {
			if (this.call === call && generation === call.endGeneration)
				call.ctx.ui.notify(asError(error).message, "warning");
		}
		// Caller speech during the farewell owns the turn and cancels hangup.
		if (this.call === call && generation === call.endGeneration)
			await this.stop();
	}

	private async stopCurrent(): Promise<void> {
		return this.ownership.hold(async () => {
			const call = this.call;
			this.call = undefined;
			this.setStatus("idle");
			if (!call) return;
			call.ctx.ui.setStatus("grok-realtime", undefined);
			call.diagnostic({ type: "call.stop" });
			call.abort.abort();
			call.session.close();
			try {
				await call.audio.close();
			} finally {
				if (call.announced) this.lifecycle(call.ctx, "ended");
			}
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
	}
	private enqueue(action: () => Promise<void>): Promise<void> {
		const result = this.operation.then(action, action);
		this.operation = result.catch(() => {});
		return result;
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
