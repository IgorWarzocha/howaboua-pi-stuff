import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GrokRealtimeConfig } from "./config.ts";
import type { GrokRealtimeController } from "./controller.ts";
import { HandoffAudio } from "./handoff-audio.ts";
import type {
	TransferredVoiceControls,
	VoiceHandoffChannel,
} from "./handoff-contract.ts";
import { asError, isRecord, VoiceHandoffLink } from "./handoff-wire.ts";

export interface IncomingVoiceHandoff {
	completion: Promise<void>;
	publish(event: string, data: unknown): void;
	forwardTo(controls: TransferredVoiceControls): void;
	close(): void;
}

export function startVoiceArrival(options: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	voice: GrokRealtimeController;
	config: GrokRealtimeConfig;
	channel: VoiceHandoffChannel;
	continuity: string;
	onClosed(error: Error): void;
}): IncomingVoiceHandoff {
	const { pi, ctx, voice } = options;
	const reservation = voice.reserveHandoffArrival();
	const abort = new AbortController();
	const signal = AbortSignal.any([abort.signal, reservation.signal]);
	let audio: HandoffAudio | undefined;
	let forwarding: TransferredVoiceControls | undefined;
	let removeForwarding: (() => void) | undefined;
	let pendingMute: boolean | undefined;
	let starting = true;
	let cleanup: Promise<void> | undefined;
	const link = new VoiceHandoffLink(options.channel, {
		async request(method, value) {
			if (method === "session.send") {
				if (typeof value !== "string" || !value.trim())
					throw new Error("Invalid text for selected session");
				if (forwarding) return forwarding.sendText(value);
				if (starting)
					throw new Error(
						"Selected-session voice is still connecting; retry after it connects",
					);
				return voice.sendText(ctx, value);
			}
			if (method === "session.rpc" && forwarding && isRecord(value))
				return forwarding.rpc(value);
			throw new Error("Selected session does not support this voice control");
		},
		notification(message) {
			if (message.type === "audio.input") audio?.receive(message);
			else if (message.type === "session.mute") {
				if (forwarding) forwarding.setInputMuted(message.muted);
				else if (starting) pendingMute = message.muted;
				else voice.mute(message.muted);
			} else throw new Error("Invalid destination voice notification");
		},
		closed(error) {
			abort.abort();
			reservation.release();
			removeForwarding?.();
			if (audio) cleanup = voice.stopWithAudio(audio);
			void cleanup?.catch(options.onClosed);
			if (forwarding) void forwarding.stop().catch(options.onClosed);
			options.onClosed(error);
		},
	});
	audio = new HandoffAudio(link);
	const remoteAudio = audio;
	const cancelled = () => link.fail(new Error("Voice transfer cancelled"));
	reservation.signal.addEventListener("abort", cancelled, { once: true });
	const completion = (async () => {
		try {
			signal.throwIfAborted();
			const prepared = await voice.prepareHandoff(ctx, options.config, signal);
			prepared.context = `${prepared.context}\nThe caller is joining this session by voice. Arrival context only, not an agent task:\n${options.continuity}`;
			link.stage("prepared");
			const activation = await link.waitFor("activate");
			if (
				!isRecord(activation) ||
				typeof activation["inputMuted"] !== "boolean" ||
				typeof activation["alternateVoice"] !== "boolean"
			)
				throw new Error(
					"Voice transfer did not provide microphone and voice phase",
				);
			signal.throwIfAborted();
			reservation.release();
			await voice.start(ctx, options.config, remoteAudio, {
				prepared,
				inputMuted: activation["inputMuted"],
				alternateVoice: activation["alternateVoice"],
				signal,
			});
			signal.throwIfAborted();
			starting = false;
			if (pendingMute !== undefined) voice.mute(pendingMute);
			link.stage("active");
			link.notify({
				type: "session.event",
				event: ctx.isIdle() ? "agent_settled" : "agent_start",
				data: {},
			});
			link.notify({
				type: "session.event",
				event: "session_info_changed",
				data: { name: pi.getSessionName() },
			});
		} catch (error) {
			link.fail(asError(error));
			await cleanup;
			throw error;
		} finally {
			reservation.release();
			reservation.signal.removeEventListener("abort", cancelled);
		}
	})();
	return {
		completion,
		publish(event, data) {
			if (!link.closed && !forwarding)
				link.notify({ type: "session.event", event, data });
		},
		forwardTo(controls) {
			if (link.closed)
				throw new Error("Previous audio connection closed during transfer");
			removeForwarding?.();
			forwarding = controls;
			removeForwarding = controls.onSessionEvent((event, data) => {
				if (!link.closed) link.notify({ type: "session.event", event, data });
			});
		},
		close() {
			link.close();
		},
	};
}
