import { createServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer } from "ws";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import { LanVoiceActivity } from "./activity.ts";
import { createLanVoiceWebManifest } from "./app-assets.ts";
import { LanHostRealtimePeer } from "./browser-peer.ts";
import { LanVoiceBrowserClients, MAX_CONTROL_BYTES } from "./browser-clients.ts";
import { resolveLanVoiceCertificate } from "./certificate.ts";
import { LanVoiceDictation } from "./dictation.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "./draft.ts";
import { boundedString, handleLanVoiceHttpRequest } from "./http-handler.ts";
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
	let conversationStart: { peer: LanHostRealtimePeer; abort: AbortController; promise: Promise<void> } | undefined;
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

	const conversationFailed = (peer: LanHostRealtimePeer, error: Error): void => {
		if (activeConversation?.peer !== peer) return;
		activeConversation = undefined;
		clients.broadcastControl({ type: "error", message: error.message });
	};
	const ensureConversation = async (): Promise<void> => {
		if (activeConversation) return;
		if (conversationStart) return conversationStart.promise;
		const peer = new LanHostRealtimePeer({
			onAudio: (pcm) => clients.sendConversationAudio(pcm),
			onFailure: (error) => conversationFailed(peer, error),
		});
		const abort = new AbortController();
		const promise = (async () => {
			let started: CodexRealtimeConversation | undefined;
			try {
				started = await options.voice.startRealtimeWithPeer(options.ctx, options.getConfig(), peer, abort.signal);
			} catch (error) {
				await peer.close();
				throw error;
			}
			if (!started) {
				await peer.close();
				throw new Error("Codex voice could not start");
			}
			activeConversation = { peer, conversation: started };
		})().finally(() => {
			if (conversationStart?.peer === peer) conversationStart = undefined;
		});
		conversationStart = { peer, abort, promise };
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
		onConversationActivity(active) {
			if (activeConversation) options.voice.setConversationInputActive(activeConversation.conversation, active);
		},
		conversationMuted: () => options.voice.inputMuted,
		onConversationMute(muted) {
			if (!options.voice.setInputMuted(muted)) throw new Error("Realtime voice is not active");
		},
		onConversationAudio(pcm) {
			activeConversation?.peer.sendAudio(pcm);
		},
		onDictationAudio: (clientId, pcm) => dictation.append(clientId, pcm),
	});
	const removeInputMuteListener = options.voice.onInputMuteChange((muted) => clients.broadcastControl({ type: "mute", muted }));

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
		const remainingConversation = activeConversation;
		if (remainingConversation) {
			activeConversation = undefined;
			await collectFailures([options.voice.stopConversation(remainingConversation.conversation, { announce: true })], failures);
		}
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

async function collectFailures(promises: ReadonlyArray<Promise<unknown> | undefined>, failures: unknown[]): Promise<void> {
	const settled = await Promise.allSettled(promises.filter((promise): promise is Promise<unknown> => promise !== undefined));
	for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
}

function configureServer(server: HttpsServer): void {
	server.keepAliveTimeout = 20_000;
	server.on("tlsClientError", () => {});
	server.on("clientError", (_error, socket) => socket.destroy());
	server.on("error", () => {});
}

function listen(server: HttpsServer, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
		const onListening = () => { server.off("error", onError); resolve(); };
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "0.0.0.0");
	});
}

function lanVoiceUrls(hostnames: string[], ipAddresses: string[], port: number): string[] {
	const hosts = [...hostnames.filter((value) => value !== "localhost"), ...ipAddresses.filter((value) => value !== "127.0.0.1")];
	if (hosts.length === 0) hosts.push("localhost");
	return [...new Set(hosts.map((host) => `https://${host}:${port}`))];
}
