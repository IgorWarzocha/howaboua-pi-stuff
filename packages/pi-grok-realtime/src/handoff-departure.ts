import type { GrokRealtimeController } from "./controller.ts";
import type {
	TransferredVoiceControls,
	VoiceHandoffChannel,
} from "./handoff-contract.ts";
import { asError, decodePcm, VoiceHandoffLink } from "./handoff-wire.ts";

export function startVoiceDeparture(options: {
	channel: VoiceHandoffChannel;
	captured: ReturnType<GrokRealtimeController["captureHandoffAudio"]>;
	waitForSettled(signal: AbortSignal): Promise<void>;
	onReleased(controls: TransferredVoiceControls): void;
	onClosed(error: Error): void;
}): { completion: Promise<void>; close(): void } {
	const { captured } = options;
	const abort = new AbortController();
	const listeners = new Set<(event: string, data: unknown) => void>();
	let released = false;
	let muted = captured.inputMuted;
	let cleanup: Promise<void> | undefined;
	const link = new VoiceHandoffLink(options.channel, {
		async request(method) {
			if (!released) throw new Error("Source audio is not ready");
			if (method === "audio.drain") return captured.audio.drain();
			throw new Error("Invalid source voice control");
		},
		notification(message) {
			if (message.type === "session.event") {
				for (const listener of listeners) listener(message.event, message.data);
			} else if (released && message.type === "audio.play")
				captured.audio.play(decodePcm(message.pcm));
			else if (released && message.type === "audio.clear")
				captured.audio.clear();
			else if (released && message.type === "session.mute") {
				muted = message.muted;
				captured.audio.setMuted(muted);
				for (const listener of listeners) listener("voice_mute", muted);
			} else throw new Error("Invalid source audio frame");
		},
		closed(error) {
			abort.abort();
			if (released) cleanup = captured.audio.close();
			if (released) captured.closed();
			void cleanup?.catch(options.onClosed);
			options.onClosed(error);
		},
	});
	const controls: TransferredVoiceControls = {
		get inputMuted() {
			return muted;
		},
		setInputMuted(value) {
			muted = value;
			captured.audio.setMuted(value);
			link.notify({ type: "session.mute", muted: value });
		},
		async stop() {
			link.close();
			await cleanup;
		},
		async sendText(text) {
			await link.request("session.send", text);
		},
		rpc(body) {
			return link.request("session.rpc", body);
		},
		onSessionEvent(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const completion = (async () => {
		try {
			await Promise.all([
				link.waitFor("prepared"),
				options.waitForSettled(abort.signal),
			]);
			abort.signal.throwIfAborted();
			await captured.release(
				{
					onAudio(pcm) {
						if (released && !muted && !link.closed)
							link.notify({ type: "audio.input", pcm: pcm.toString("base64") });
					},
					onError(error) {
						link.fail(error);
					},
				},
				controls,
			);
			released = true;
			if (link.closed) {
				await captured.audio.close();
				captured.closed();
				throw new Error("Voice connection closed during release");
			}
			options.onReleased(controls);
			link.stage("activate", {
				inputMuted: muted,
				alternateVoice: !captured.alternateVoice,
			});
			await link.waitFor("active");
		} catch (error) {
			link.fail(asError(error));
			await cleanup;
			throw new Error(
				`Voice transfer failed; the original call ${captured.sourceActive() ? "remains active" : "is no longer active"}. ${asError(error).message}`,
			);
		}
	})();
	return { completion, close: () => link.close() };
}
