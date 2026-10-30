import type {
	TransferredVoiceControls,
	VoiceHandoffChannel,
} from "./handoff-contract.ts";
import { type CapturedHandoffAudio, HandoffAudioHost } from "./handoff-peer.ts";
import { asError, isRecord, VoiceHandoffLink } from "./handoff-wire.ts";
import {
	decodeLanTakeoverOffer,
	type LanTakeoverOffer,
} from "./lan/takeover.ts";

export function startVoiceDeparture(options: {
	channel: VoiceHandoffChannel;
	captured: CapturedHandoffAudio;
	waitForSettled(signal: AbortSignal): Promise<void>;
	onReleased(controls: TransferredVoiceControls): void;
	onClosed(error: Error): void;
	lanTakeover?: (
		offer: LanTakeoverOffer | undefined,
		releaseAudio: (beforeStop?: () => Promise<void>) => Promise<void>,
		verify: (value: unknown) => Promise<unknown>,
	) => Promise<number | undefined>;
}): { completion: Promise<void>; readonly detached: boolean; close(): void } {
	const abort = new AbortController();
	const listeners = new Set<(event: string, data: unknown) => void>();
	let audio: HandoffAudioHost | undefined;
	let cleanup: Promise<void> | undefined;
	let takenOver = false;
	const publish = (event: string, data: unknown) => {
		for (const listener of listeners) listener(event, data);
	};
	const link = new VoiceHandoffLink(options.channel, {
		async request(method, value) {
			if (!audio) throw new Error("Source audio is not ready");
			if (method === "peer.start") return audio.start();
			if (method === "peer.close") return audio.closePeer(value);
			throw new Error(
				"Voice control was sent to the audio host instead of the selected session",
			);
		},
		notification(message) {
			if (message.type === "peer.command") audio?.command(message);
			else if (message.type === "session.event")
				publish(message.event, message.data);
			else throw new Error("Invalid source voice notification");
		},
		closed(error) {
			abort.abort();
			cleanup = audio?.close(error);
			void cleanup?.catch(options.onClosed);
			if (!takenOver) options.onClosed(error);
		},
	});
	const controls: TransferredVoiceControls = {
		get inputMuted() {
			return audio?.inputMuted ?? options.captured.inputMuted;
		},
		setInputMuted(muted) {
			audio?.setInputMuted(muted);
			link.notify({ type: "session.mute", muted });
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
	audio = new HandoffAudioHost(options.captured, link, controls, (muted) =>
		publish("voice_mute", muted),
	);
	const completion = (async () => {
		try {
			if (abort.signal.aborted)
				throw new Error("Voice connection closed before transfer");
			const [prepared] = await Promise.all([
				link.waitFor("prepared"),
				options.waitForSettled(abort.signal),
			]);
			if (options.lanTakeover) {
				const offered = isRecord(prepared)
					? prepared["lanTakeover"]
					: undefined;
				const offer =
					offered === undefined ? undefined : decodeLanTakeoverOffer(offered);
				const port = await options.lanTakeover(
					offer,
					(beforeStop) => {
						options.captured.bindControls(controls);
						return audio!.release(abort.signal, beforeStop);
					},
					(value) => link.request("lan.verify", value),
				);
				if (port !== undefined && offer) {
					link.stage("activate", {
						inputMuted: audio.inputMuted,
						alternateVoice: !(options.captured.alternateVoice ?? false),
						lanTakeover: { token: offer.token, port },
					});
					const active = await link.waitFor("active");
					if (!isRecord(active) || active["lanTakeover"] !== true)
						throw new Error("The target did not confirm its LAN listener");
					takenOver = true;
					link.close();
					await cleanup;
					return;
				}
			}
			options.captured.bindControls(controls);
			await audio.release(abort.signal);
			options.onReleased(controls);
			link.stage("activate", {
				inputMuted: audio.inputMuted,
				alternateVoice: !(options.captured.alternateVoice ?? false),
			});
			await link.waitFor("active");
		} catch (error) {
			link.fail(asError(error));
			// A close replay can precede construction of the audio owner.
			cleanup ??= audio.close(asError(error));
			await cleanup;
			throw new Error(
				`Voice transfer failed; the original voice call ${options.captured.sourceActive() ? "remains active" : "is no longer active"}. ${asError(error).message}`,
			);
		}
	})();
	return {
		completion,
		get detached() {
			return takenOver;
		},
		close: () => link.close(),
	};
}
