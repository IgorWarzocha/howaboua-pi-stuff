import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AudioCallbacks, RealtimeAudio } from "../audio.ts";
import type { GrokRealtimeConfig } from "../config.ts";
import { prepareContext } from "../context.ts";
import type { PreparedVoice } from "../controller.ts";
import { resolveConnection } from "../credentials.ts";
import type { GrokSession } from "../session.ts";
import { loadVoicePrompt } from "../system-prompt.ts";
import type { collectGrokTools, GrokToolWireDefinition } from "../tools.ts";
import { createCallSession, type GrokCallEffects } from "./session.ts";

export interface GrokCallArrival {
	prepared: PreparedVoice;
	alternateVoice: boolean;
	inputMuted: boolean;
	signal: AbortSignal;
}
/** One local call owns its audio, socket replacements and cancellation. */
export class GrokCall {
	readonly abort = new AbortController();
	readonly audio: RealtimeAudio;
	session: GrokSession;
	readonly ctx: ExtensionContext;
	readonly config: GrokRealtimeConfig;
	muted = false;
	piBusy: boolean;
	announced = false;
	endGeneration = 0;
	playbackGeneration = 0;
	reconnecting = false;
	instructions = "";
	readonly tools: readonly GrokToolWireDefinition[];
	readonly diagnostic: (event: Record<string, unknown>) => void;
	removeAudioAbort: () => void = () => {};
	inputCallbacks: AudioCallbacks;
	readonly alternateVoice: boolean;
	private readonly pi: ExtensionAPI;
	private readonly effects: GrokCallEffects;
	private readonly toolCollection: ReturnType<typeof collectGrokTools>;
	constructor(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		config: GrokRealtimeConfig,
		audio: RealtimeAudio,
		tools: ReturnType<typeof collectGrokTools>,
		effects: GrokCallEffects,
		alternateVoice: boolean,
	) {
		this.pi = pi;
		this.ctx = ctx;
		this.config = config;
		this.audio = audio;
		this.toolCollection = tools;
		this.effects = effects;
		this.alternateVoice = alternateVoice;
		const callId = crypto.randomUUID();
		this.diagnostic = (event) =>
			pi.appendEntry("grok-realtime-diagnostic", { callId, ...event });
		this.diagnostic({ type: "call.start", mode: audio.constructor.name });
		this.session = this.createSession();
		this.piBusy = !ctx.isIdle();
		this.tools = tools.definitions;
		this.inputCallbacks = {
			onAudio: (pcm) => {
				if (this.effects.isCurrent() && !this.muted)
					this.session.appendAudio(pcm);
			},
			onError: (error) => {
				ctx.ui.notify(error.message, "error");
				void this.effects.stop();
			},
		};
	}
	createSession(): GrokSession {
		return createCallSession(
			this.pi,
			this.ctx,
			this.audio,
			this.toolCollection,
			this.abort,
			this,
			this.effects,
		);
	}
	async start(arrival?: GrokCallArrival): Promise<void> {
		const { ctx, config, audio, abort, session, toolCollection: tools } = this;
		const instructions =
			arrival?.prepared.instructions ?? loadVoicePrompt(ctx.cwd);
		this.instructions = instructions;
		this.effects.status("summarizing");
		const context =
			arrival?.prepared.context ??
			(await prepareContext(ctx, config, abort.signal));
		if (context)
			this.pi.appendEntry("grok-realtime-context", { text: context });
		this.effects.status("connecting");
		const connection =
			arrival?.prepared.connection ??
			(await resolveConnection(ctx, config.model, config.access, abort.signal));
		if (abort.signal.aborted) throw new Error("Voice startup cancelled");
		const cancelAudio = () => {
			void audio.close();
		};
		abort.signal.addEventListener("abort", cancelAudio, { once: true });
		this.removeAudioAbort = () =>
			abort.signal.removeEventListener("abort", cancelAudio);
		const cancelArrival = () => abort.abort();
		arrival?.signal.addEventListener("abort", cancelArrival, {
			once: true,
		});
		if (arrival?.signal.aborted) abort.abort();
		await audio.start({
			onAudio: (pcm) => {
				try {
					this.inputCallbacks.onAudio(pcm);
				} catch (error) {
					ctx.ui.notify(asError(error).message, "error");
					void this.effects.stop();
				}
			},
			onError: (error) => {
				this.inputCallbacks.onError(error);
			},
		});
		if (abort.signal.aborted) throw new Error("Voice startup cancelled");
		session.setPiBusy(!ctx.isIdle());
		if (arrival) {
			this.muted = arrival.inputMuted;
			audio.setMuted(this.muted);
			session.setMuted(this.muted);
		}
		await session.start(
			connection,
			config,
			context,
			abort.signal,
			tools.definitions,
			instructions,
			Boolean(arrival),
		);
		arrival?.signal.removeEventListener("abort", cancelArrival);
		if (arrival)
			session.context(
				"The caller has just been put through to this Pi session. Greet them briefly with a distinct welcome to this session; do not recap prior work or start an agent task.",
			);
		this.effects.lifecycle(ctx, "started");
		this.announced = true;
	}
	async resume(error: Error): Promise<void> {
		if (
			!this.effects.isCurrent() ||
			this.abort.signal.aborted ||
			this.reconnecting
		)
			return;
		if (!this.config.autoResume) {
			this.ctx.ui.notify(
				`${error.message}; start a new call to reconnect`,
				"error",
			);
			await this.effects.stop();
			return;
		}
		// Like GipPity, replace an established dropped session once, without a retry loop.
		this.reconnecting = true;
		try {
			this.endGeneration++;
			this.playbackGeneration++;
			this.session.close();
			this.audio.clear();
			this.session = this.createSession();
			this.session.setMuted(this.muted);
			this.session.setPiBusy(this.piBusy);
			this.effects.status("reconnecting");
			this.diagnostic({ type: "call.reconnecting", message: error.message });
			const context = await prepareContext(
				this.ctx,
				this.config,
				this.abort.signal,
			);
			if (context)
				this.pi.appendEntry("grok-realtime-context", { text: context });
			const connection = await resolveConnection(
				this.ctx,
				this.config.model,
				this.config.access,
				this.abort.signal,
			);
			if (!this.effects.isCurrent() || this.abort.signal.aborted) return;
			await this.session.start(
				connection,
				this.config,
				context,
				this.abort.signal,
				this.tools,
				this.instructions,
				true,
			);
			this.diagnostic({ type: "call.resumed" });
		} catch (resumeError) {
			if (this.effects.isCurrent() && !this.abort.signal.aborted) {
				this.ctx.ui.notify(
					`Grok voice could not resume: ${asError(resumeError).message}. Start a new call to reconnect`,
					"error",
				);
				await this.effects.stop();
			}
		} finally {
			this.reconnecting = false;
		}
	}

	async finish(): Promise<void> {
		if (!this.effects.isCurrent()) return;
		const generation = ++this.endGeneration;
		this.effects.status("ending");
		try {
			await this.audio.drain();
		} catch (error) {
			if (this.effects.isCurrent() && generation === this.endGeneration)
				this.ctx.ui.notify(asError(error).message, "warning");
		}
		// Caller speech during the farewell owns the turn and cancels hangup.
		if (this.effects.isCurrent() && generation === this.endGeneration)
			await this.effects.stop();
	}

	async close(): Promise<void> {
		this.ctx.ui.setStatus("grok-realtime", undefined);
		this.diagnostic({ type: "call.stop" });
		this.abort.abort();
		this.removeAudioAbort();
		this.session.close();
		try {
			await this.audio.close();
		} finally {
			if (this.announced) this.effects.lifecycle(this.ctx, "ended");
		}
	}
}
export function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
