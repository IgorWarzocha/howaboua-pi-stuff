import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../config.ts";
import {
	prepareControllerRealtimeContext,
	type RealtimePeerPlan,
} from "./controller/start.ts";
import type { CodexVoiceController } from "./controller.ts";
import type {
	TransferredVoiceControls,
	VoiceHandoffChannel,
} from "./handoff-contract.ts";
import { HandoffRemotePeer } from "./handoff-peer.ts";
import { asError, isRecord, VoiceHandoffLink } from "./handoff-wire.ts";
import type { CodexLanVoiceServerController } from "./lan/controller.ts";
import { remoteJsonValue } from "./lan/remote-json.ts";
import {
	decodeLanRemoteRpcRequest,
	invokeLanRemoteRpc,
	lanRemoteRpcError,
} from "./lan/rpc.ts";
import { verifyLanTakeoverListener } from "./lan/takeover.ts";
import { resolveRealtimeVoiceAuth } from "./realtime-auth.ts";

export interface IncomingVoiceHandoff {
	completion: Promise<void>;
	readonly detached: boolean;
	publish(event: string, data: unknown): void;
	forwardTo(controls: TransferredVoiceControls): void;
	close(): void;
}

export function startVoiceArrival(options: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	voice: CodexVoiceController;
	lanVoice: CodexLanVoiceServerController;
	config: GippityControlConfig;
	channel: VoiceHandoffChannel;
	continuity: string;
	onClosed(error: Error): void;
}): IncomingVoiceHandoff {
	const { pi, ctx, voice } = options;
	const reservation = voice.reserveHandoffArrival();
	const abort = new AbortController();
	const signal = AbortSignal.any([abort.signal, reservation.signal]);
	let peer: HandoffRemotePeer | undefined;
	let forwarding: TransferredVoiceControls | undefined;
	let removeForwarding: (() => void) | undefined;
	let closed = false;
	let pendingMute: boolean | undefined;
	let starting = true;
	let plan: RealtimePeerPlan | undefined;
	let cleanup: Promise<void> | undefined;
	let lanPreparation:
		| Awaited<ReturnType<CodexLanVoiceServerController["prepareTakeover"]>>
		| undefined;
	let lanCommitted = false;
	const link = new VoiceHandoffLink(options.channel, {
		async request(method, value) {
			if (method === "lan.verify") {
				if (!lanPreparation) throw new Error("LAN takeover was not prepared");
				await verifyLanTakeoverListener(
					lanPreparation.certificate.cert,
					value,
					signal,
				);
				return;
			}
			if (method === "session.send") {
				if (
					typeof value !== "string" ||
					!value.trim() ||
					Buffer.byteLength(value) > 64 * 1024
				)
					throw new Error("Invalid text for the selected session");
				if (forwarding) return forwarding.sendText(value);
				pi.sendUserMessage(
					value,
					ctx.isIdle() ? undefined : { deliverAs: "steer" },
				);
				return;
			}
			if (method === "session.rpc") {
				if (!isRecord(value))
					throw new Error("Invalid selected-session request");
				if (forwarding) return forwarding.rpc(value);
				try {
					const request = decodeLanRemoteRpcRequest(value);
					return {
						id: request.id ?? null,
						ok: true,
						result: await invokeLanRemoteRpc({ request, pi, ctx }),
					};
				} catch (error) {
					const id = value["id"];
					return {
						id: typeof id === "string" || typeof id === "number" ? id : null,
						ok: false,
						error: lanRemoteRpcError(error),
					};
				}
			}
			throw new Error(
				"Voice control was sent to the selected session instead of its audio host",
			);
		},
		notification(message) {
			if (message.type === "peer.event")
				peer?.receive(message.generation, message.event);
			else if (message.type === "session.mute") {
				if (forwarding) forwarding.setInputMuted(message.muted);
				else if (starting) pendingMute = message.muted;
				else if (!voice.setInputMuted(message.muted))
					throw new Error("Selected-session voice is not active");
			} else throw new Error("Invalid selected-session voice notification");
		},
		closed(error) {
			closed = true;
			if (lanCommitted) return;
			abort.abort();
			reservation.release();
			lanPreparation?.release();
			removeForwarding?.();
			if (plan)
				cleanup = voice.stopRealtimeWithPeerPlan(plan, { announce: true });
			void cleanup?.catch(options.onClosed);
			peer?.disconnected(error);
			options.onClosed(error);
		},
	});
	const cancelled = () => link.fail(new Error("Voice transfer cancelled"));
	reservation.signal.addEventListener("abort", cancelled, { once: true });
	plan = {
		createPeer() {
			peer = new HandoffRemotePeer(link);
			return peer;
		},
		onStatus(status) {
			if (!closed)
				link.notify({
					type: "session.event",
					event: "voice_status",
					data: status,
				});
		},
		onInactive(_session, error, resuming) {
			if (!resuming) link.fail(error);
		},
		onStopped() {
			link.close();
		},
	};
	const completion = (async () => {
		try {
			signal.throwIfAborted();
			if (!voice.prepareRealtimePrompt(ctx))
				throw new Error("Target realtime voice is not configured");
			const [prepared] = await Promise.all([
				prepareControllerRealtimeContext({
					ctx,
					config: options.config,
					signal,
				}),
				resolveRealtimeVoiceAuth(ctx, options.config, pi),
			]);
			signal.throwIfAborted();
			prepared.initialItems = [
				...(prepared.initialItems ?? []),
				{
					type: "message",
					role: "developer",
					content: [
						{
							type: "input_text",
							text: `The user is joining this session by voice. The following is arrival context, not a request to start an agent task.\n${options.continuity}`,
						},
					],
				},
			];
			try {
				lanPreparation = await options.lanVoice.prepareTakeover(ctx);
			} catch {
				/* Ordinary non-LAN transfers do not require a free LAN listener or certificate. */
			}
			signal.throwIfAborted();
			link.stage(
				"prepared",
				lanPreparation ? { lanTakeover: lanPreparation.offer } : undefined,
			);
			const activation = await link.waitFor("activate");
			if (
				!isRecord(activation) ||
				typeof activation["inputMuted"] !== "boolean"
			)
				throw new Error("Voice transfer did not provide its microphone state");
			if (
				activation["alternateVoice"] !== undefined &&
				typeof activation["alternateVoice"] !== "boolean"
			)
				throw new Error("Voice transfer provided an invalid voice selection");
			signal.throwIfAborted();
			reservation.release();
			const takeover = activation["lanTakeover"];
			if (takeover !== undefined) {
				if (
					!lanPreparation ||
					!isRecord(takeover) ||
					takeover["token"] !== lanPreparation.offer.token ||
					typeof takeover["port"] !== "number" ||
					!Number.isInteger(takeover["port"]) ||
					takeover["port"] < 1 ||
					takeover["port"] > 65535
				)
					throw new Error("Invalid LAN takeover activation");
				plan = undefined;
				await lanPreparation.start(
					takeover["port"],
					prepared,
					activation["inputMuted"],
					activation["alternateVoice"] === true,
					signal,
				);
				signal.throwIfAborted();
				lanCommitted = true;
				starting = false;
				link.stage("active", { lanTakeover: true });
				return;
			}
			lanPreparation?.release();
			const session = await voice.startRealtimeWithPeerPlan(
				ctx,
				options.config,
				plan,
				signal,
				prepared,
				activation["inputMuted"],
				activation["alternateVoice"] === true,
			);
			if (!session)
				throw new Error(
					"Destination voice could not start; text focus remains available",
				);
			starting = false;
			if (pendingMute !== undefined) voice.setInputMuted(pendingMute);
			link.stage("active");
			link.notify({
				type: "session.event",
				event: "session_info_changed",
				data: { type: "session_info_changed", name: pi.getSessionName() },
			});
			link.notify({
				type: "session.event",
				event: ctx.isIdle() ? "agent_settled" : "agent_start",
				data: {},
			});
		} catch (error) {
			link.fail(asError(error));
			if (lanCommitted) {
				lanCommitted = false;
				await options.lanVoice.stop(ctx);
			}
			await cleanup;
			throw error;
		} finally {
			lanPreparation?.release();
			reservation.release();
			reservation.signal.removeEventListener("abort", cancelled);
		}
	})();
	return {
		completion,
		get detached() {
			return lanCommitted;
		},
		publish(event, data) {
			if (!closed && !forwarding)
				link.notify({
					type: "session.event",
					event,
					data: remoteJsonValue(data),
				});
		},
		forwardTo(controls) {
			if (closed)
				throw new Error("The previous audio connection closed during transfer");
			removeForwarding?.();
			forwarding = controls;
			removeForwarding = controls.onSessionEvent((event, data) => {
				if (!closed) link.notify({ type: "session.event", event, data });
			});
		},
		close() {
			link.close();
		},
	};
}
