import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreparedRealtimeContext, RealtimePeerPlan } from "../controller/start.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import type { LanVoiceActivity } from "./activity.ts";
import type { LanVoiceBrowserClients } from "./browser-clients.ts";
import { LanHostRealtimePeer } from "./browser-peer.ts";
import type { LanTakeoverArrival } from "./takeover.ts";
import { LanTransferredSession } from "./transferred-session.ts";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";

export interface LanConversationState {
 activeConversation?: { peer: LanHostRealtimePeer; conversation?: CodexRealtimeConversation } | undefined;
 conversationStart?: { abort: AbortController; promise: Promise<void> } | undefined;
 realtimePlan?: RealtimePeerPlan | undefined;
 transferred?: LanTransferredSession | undefined;
}

export function createLanConversationStarter(options: {
 state: LanConversationState;
 ctx: ExtensionContext;
 voice: CodexVoiceController;
 getConfig(): CodexConversionConfig;
 arrival: LanTakeoverArrival<{ prepared: PreparedRealtimeContext; inputMuted: boolean; alternateVoice: boolean }>;
 clients(): LanVoiceBrowserClients;
 activity: LanVoiceActivity;
}): (takeoverToken?: string) => Promise<void> {
 const { state } = options;
	return async (takeoverToken?: string): Promise<void> => {
		if (state.activeConversation) return;
		// A stopped or disconnected selection must never silently return to origin.
		if (state.transferred) return state.transferred.startCall();
		if (state.conversationStart) return state.conversationStart.promise;
		if (state.realtimePlan) return;
		const preparedArrival = options.arrival.consume(takeoverToken);
		const abort = new AbortController();
		let activated = false;
		const plan: RealtimePeerPlan = {
			onStatus: (status) => {
				if (!state.transferred) options.clients().broadcastControl({ type: "status", status });
			},
			createPeer: () => {
				let peer!: LanHostRealtimePeer;
				peer = new LanHostRealtimePeer({
					onAudio: (pcm) => {
						if (state.activeConversation?.peer === peer)
							options.clients().sendConversationAudio(pcm);
					},
					onSpeakerSuppressed: (suppressed) => {
						if (state.activeConversation?.peer === peer)
							options.clients().setConversationSpeakerSuppressed(suppressed);
					},
				});
				return peer;
			},
			onStopped: () => {
				if (state.transferred || state.realtimePlan !== plan) return;
				state.activeConversation = undefined;
				state.realtimePlan = undefined;
				options.clients().broadcastControl({ type: "stop", reason: "voice-ended" });
			},
			onTransferred: (peer, controls) => {
				state.realtimePlan = plan;
				if (state.transferred?.controls !== controls) {
					state.transferred?.detach();
					state.transferred = new LanTransferredSession(controls, options.clients(), options.activity);
				}
				state.activeConversation = { peer: peer as LanHostRealtimePeer };
				options.clients().setConversationSpeakerSuppressed(
					state.activeConversation.peer.isSpeakerSuppressed,
				);
			},
			onTransferEnded: (peer, error) => {
				if (
					!state.transferred ||
					(state.activeConversation && state.activeConversation.peer !== peer)
				)
					return;
				state.transferred?.end();
				state.activeConversation = undefined;
				if (state.realtimePlan === plan) state.realtimePlan = undefined;
				options.clients().broadcastControl(
					error
						? { type: "error", message: error.message }
						: { type: "stop", reason: "transfer-ended" },
				);
			},
			onActive: (conversation, peer) => {
				activated = true;
				state.activeConversation = {
					peer: peer as LanHostRealtimePeer,
					conversation,
				};
				options.clients().setConversationSpeakerSuppressed(
					state.activeConversation.peer.isSpeakerSuppressed,
				);
			},
			onInactive: (conversation, error, resuming) => {
				if (state.transferred) return;
				const ownedActive = state.activeConversation?.conversation === conversation;
				if (!ownedActive && state.realtimePlan !== plan) return;
				if (ownedActive) state.activeConversation = undefined;
				if (resuming) return;
				if (state.realtimePlan === plan) state.realtimePlan = undefined;
				if (activated)
					options.clients().broadcastControl({ type: "error", message: error.message });
			},
		};
		state.realtimePlan = plan;
		const promise = (async () => {
			const started = await options.voice.startRealtimeWithPeerPlan(
				options.ctx,
				options.getConfig(),
				plan,
				abort.signal,
				preparedArrival?.prepared,
				preparedArrival?.inputMuted,
				preparedArrival?.alternateVoice,
			);
			if (!started) throw new Error("Codex voice could not start");
		})().finally(() => {
			if (state.conversationStart?.abort === abort) state.conversationStart = undefined;
			if (!activated && state.realtimePlan === plan) state.realtimePlan = undefined;
		});
		state.conversationStart = { abort, promise };
		return promise;
	};
}
