import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer } from "ws";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { RealtimePeerPlan } from "../controller-start.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import { LanVoiceActivity } from "./activity.ts";
import { createLanVoiceWebManifest } from "./app-assets.ts";
import { LanHostRealtimePeer } from "./browser-peer.ts";
import { LanVoiceBrowserClients, MAX_CONTROL_BYTES } from "./browser-clients.ts";
import { resolveLanVoiceCertificate } from "./certificate.ts";
import { LanVoiceDictation } from "./dictation.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "./draft.ts";
import { boundedString, handleLanVoiceHttpRequest } from "./http-handler.ts";
import { collectFailures, configureServer, lanVoiceUrls, listen } from "./server-runtime.ts";
import { createLanVoiceWebUi } from "./web-ui.ts";

const PORT = 43_120;
const HEARTBEAT_MS = 15_000;

export interface CodexLanVoiceServer {
	readonly ownerSessionId: string;
	readonly urls: string[];
	agentStarted(): void;
	agentSettled(text?: string): void;
	close(): Promise<void>;
}

export async function startCodexLanVoiceServer(options: {
	ctx: ExtensionContext;
	getConfig: () => CodexConversionConfig;
	voice: CodexVoiceController;
	resolveAuth(): Promise<CodexVoiceAuth>;
	sendUserMessage(text: string): void;
	ownerSessionId: string;
	port?: number | undefined;
	certificateAgentDir: string;
}): Promise<CodexLanVoiceServer> {
	const certificate = resolveLanVoiceCertificate(options.certificateAgentDir);
	const ownerIsActive = () => options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	let activeConversation: { peer: LanHostRealtimePeer; conversation: CodexRealtimeConversation } | undefined;
	let conversationStart: { abort: AbortController; promise: Promise<void> } | undefined;
	let realtimePlan: RealtimePeerPlan | undefined;
	let closing = false;
	let clients!: LanVoiceBrowserClients;
	const activity = new LanVoiceActivity({
		initialWorking: !options.ctx.isIdle(),
		publish: (message) => clients.broadcastControl(message),
	});
	const draft = new LanVoiceDraft({
		publish: (message) => clients.broadcastControl(message),
		sendMessage: options.sendUserMessage,
	});
	const dictation = new LanVoiceDictation({
		resolveAuth: options.resolveAuth,
		onError: (clientId, error) => clients.sendControl(clientId, { type: "error", message: error.message }),
	});

	const ensureConversation = async (): Promise<void> => {
		if (activeConversation) return;
		if (conversationStart) return conversationStart.promise;
		if (realtimePlan) return;
		const abort = new AbortController();
		let activated = false;
		const plan: RealtimePeerPlan = {
			onStatus: (status) => clients.broadcastControl({ type: "status", status }),
			createPeer: () => {
				let peer!: LanHostRealtimePeer;
				peer = new LanHostRealtimePeer({
					onAudio: (pcm) => {
						if (activeConversation?.peer === peer)
							clients.sendConversationAudio(pcm);
					},
				});
				return peer;
			},
			onActive: (conversation, peer) => {
				activated = true;
				activeConversation = {
					peer: peer as LanHostRealtimePeer,
					conversation,
				};
			},
			onInactive: (conversation, error, resuming) => {
				const ownedActive = activeConversation?.conversation === conversation;
				if (!ownedActive && realtimePlan !== plan) return;
				if (ownedActive)
					activeConversation = undefined;
				if (resuming) return;
				if (realtimePlan === plan) realtimePlan = undefined;
				if (activated)
					clients.broadcastControl({ type: "error", message: error.message });
			},
		};
		realtimePlan = plan;
		const promise = (async () => {
			const started = await options.voice.startRealtimeWithPeerPlan(
				options.ctx,
				options.getConfig(),
				plan,
				abort.signal,
			);
			if (!started) throw new Error("Codex voice could not start");
		})().finally(() => {
			if (conversationStart?.abort === abort) conversationStart = undefined;
			if (!activated && realtimePlan === plan) realtimePlan = undefined;
		});
		conversationStart = { abort, promise };
		return promise;
	};
	clients = new LanVoiceBrowserClients({
		ensureConversation,
		async startDictation(clientId) {
			await dictation.start(clientId);
			options.voice.announceDictation(options.ctx);
		},
		async finishDictation(clientId, text, revision, selection) {
			const transcript = await dictation.finish(clientId);
			let insertion = selection;
			if (text !== undefined) {
				try {
					draft.update(clientId, text, revision);
				} catch (error) {
					if (!(error instanceof LanVoiceDraftConflictError)) throw error;
					insertion = undefined;
				}
			}
			if (transcript) draft.insertTranscript(clientId, transcript, insertion);
		},
		cancelDictation: (clientId) => dictation.cancel(clientId),
		async onConversationActivity(active) {
			const current = activeConversation;
			if (active) {
				if (current)
					options.voice.setConversationInputActive(current.conversation, true);
				return;
			}
			const plan = realtimePlan;
			realtimePlan = undefined;
			activeConversation = undefined;
			if (plan)
				await options.voice.stopRealtimeWithPeerPlan(plan, { announce: true });
		},
		conversationMuted: () => options.voice.inputMuted,
		onConversationMute(muted) {
			if (!options.voice.setInputMuted(muted)) throw new Error("Realtime voice is not active");
		},
		onConversationInputTooQuiet(inputTooQuiet) {
			options.voice.setInputTooQuiet(inputTooQuiet);
			clients.broadcastControl({ type: "microphone", state: inputTooQuiet ? "too-quiet" : "ok" });
		},
		onConversationAudio(pcm) {
			activeConversation?.peer.sendAudio(pcm);
		},
		onDictationAudio: (clientId, pcm) => dictation.append(clientId, pcm),
	});
	const removeInputMuteListener = options.voice.onInputMuteChange((muted) => {
		if (muted) clients.resetConversationInputLevel();
		clients.broadcastControl({ type: "mute", muted });
	});

	const server = createServer({ cert: certificate.cert, key: certificate.key }, (request, response) => {
		void handleLanVoiceHttpRequest(request, response, {
			activity,
			clients,
			draft,
			inputMuted: () => options.voice.inputMuted,
			renderManifest: () => createLanVoiceWebManifest(options.ctx.ui.theme),
			renderPage: () => createLanVoiceWebUi(options.ctx.ui.theme),
			ownerIsActive,
			get closing() { return closing; },
		});
	});
	const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_CONTROL_BYTES });
	server.on("upgrade", (request, socket, head) => {
		try {
			const url = new URL(request.url ?? "/", "https://lan-voice.local");
			const clientId = boundedString(url.searchParams.get("client"), 128);
			if (url.pathname !== "/api/audio" || !clientId || !ownerIsActive() || closing) {
				socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
			webSockets.handleUpgrade(request, socket, head, (webSocket) => clients.connectAudio(clientId, webSocket));
		} catch {
			socket.destroy();
		}
	});
	configureServer(server);
	try {
		await listen(server, options.port ?? PORT);
	} catch (error) {
		removeInputMuteListener();
		const clientsClosing = clients.close();
		webSockets.close();
		server.closeAllConnections();
		await Promise.allSettled([clientsClosing, dictation.close()]);
		throw error;
	}
	const heartbeat = setInterval(() => clients.heartbeat(), HEARTBEAT_MS);
	const address = server.address() as AddressInfo;
	const urls = lanVoiceUrls(certificate.hostnames, certificate.ipAddresses, address.port);
	let closePromise: Promise<void> | undefined;
	const closeServer = async (): Promise<void> => {
		closing = true;
		removeInputMuteListener();
		conversationStart?.abort.abort();
		conversationStart = undefined;
		clearInterval(heartbeat);
		const clientsClosing = clients.close();
		const failures: unknown[] = [];
		await collectFailures([clientsClosing, dictation.close()], failures);
		const remainingPlan = realtimePlan;
		realtimePlan = undefined;
		activeConversation = undefined;
		if (remainingPlan)
			await collectFailures([
				options.voice.stopRealtimeWithPeerPlan(remainingPlan, { announce: true }),
			], failures);
		await collectFailures([
			new Promise<void>((resolve) => webSockets.close(() => resolve())),
			new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
		], failures);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "LAN voice server cleanup failed");
	};

	return {
		ownerSessionId: options.ownerSessionId,
		urls,
		agentStarted: () => activity.working(),
		agentSettled: (text) => activity.settled(text),
		close() {
			closePromise ??= closeServer();
			return closePromise;
		},
	};
}
