import { createServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer } from "ws";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import { LanVoiceBrowserClients, MAX_PCM_BYTES } from "./browser-clients.ts";
import { resolveLanVoiceCertificate } from "./certificate.ts";
import { createLanVoiceDiagnostics } from "./diagnostics.ts";
import { LanVoiceDictation } from "./dictation.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "./draft.ts";
import { boundedString, handleLanVoiceHttpRequest } from "./http-handler.ts";
import { LanVoiceUpstreamPeer } from "./upstream-peer.ts";

const PORT = 43_120;
const HEARTBEAT_MS = 15_000;

export interface CodexLanVoiceServer {
	readonly ownerSessionId: string;
	readonly urls: string[];
	readonly logPath: string;
	close(): Promise<void>;
}

export async function startCodexLanVoiceServer(options: {
	ctx: ExtensionContext;
	getConfig: () => CodexConversionConfig;
	voice: CodexVoiceController;
	sendUserMessage(text: string): void;
	ownerSessionId: string;
	port?: number | undefined;
	certificateAgentDir: string;
}): Promise<CodexLanVoiceServer> {
	const diagnostics = createLanVoiceDiagnostics(options.certificateAgentDir);
	const certificate = resolveLanVoiceCertificate(options.certificateAgentDir);
	const ownerIsActive = () => options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	let upstreamPeer: LanVoiceUpstreamPeer | undefined;
	let conversation: CodexRealtimeConversation | undefined;
	let closing = false;
	let clients!: LanVoiceBrowserClients;
	const draft = new LanVoiceDraft({
		diagnostics,
		publish: (message) => clients.broadcastControl(message),
		sendMessage: options.sendUserMessage,
	});
	const dictation = new LanVoiceDictation({
		ctx: options.ctx,
		diagnostics,
		onError: (clientId, error) => clients.sendControl(clientId, { type: "error", message: error.message }),
	});

	const clearUpstream = (peer?: LanVoiceUpstreamPeer): void => {
		if (peer && upstreamPeer !== peer) return;
		upstreamPeer = undefined;
		conversation = undefined;
	};
	const ensureConversation = async (): Promise<void> => {
		if (conversation && upstreamPeer) return;
		let peer!: LanVoiceUpstreamPeer;
		peer = new LanVoiceUpstreamPeer(diagnostics, (pcm) => clients.sendConversationAudio(pcm));
		peer.onExit(() => clearUpstream(peer));
		upstreamPeer = peer;
		const started = await options.voice.startRealtimeWithPeer(options.ctx, options.getConfig(), peer);
		if (!started) {
			clearUpstream(peer);
			await peer.close();
			throw new Error("Codex voice could not start");
		}
		conversation = started;
	};
	clients = new LanVoiceBrowserClients({
		diagnostics,
		ensureConversation,
		startDictation: (clientId) => dictation.start(clientId),
		async finishDictation(clientId, text, revision, selection) {
			const transcript = await dictation.finish(clientId);
			let insertion = selection;
			if (text !== undefined) {
				try {
					draft.update(clientId, text, revision);
				} catch (error) {
					if (!(error instanceof LanVoiceDraftConflictError)) throw error;
					insertion = undefined;
					diagnostics.write("server", "draft.finish_conflict", { clientId });
				}
			}
			if (transcript) draft.insertTranscript(clientId, transcript, insertion);
		},
		onConversationAudio(pcm) {
			const peer = upstreamPeer;
			if (peer) peer.sendAudio(pcm);
		},
		onDictationAudio: (clientId, pcm) => dictation.append(clientId, pcm),
	});

	const server = createServer({ cert: certificate.cert, key: certificate.key }, (request, response) => {
		void handleLanVoiceHttpRequest(request, response, {
			diagnostics,
			clients,
			draft,
			ownerIsActive,
			get closing() { return closing; },
		});
	});
	const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PCM_BYTES });
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
		} catch (error) {
			diagnostics.write("server", "audio.upgrade_error", error);
			socket.destroy();
		}
	});
	configureServerDiagnostics(server, diagnostics.write.bind(diagnostics));
	try {
		await listen(server, options.port ?? PORT);
	} catch (error) {
		clients.close();
		webSockets.close();
		server.closeAllConnections();
		await diagnostics.close();
		throw error;
	}
	const heartbeat = setInterval(() => clients.heartbeat(), HEARTBEAT_MS);
	const address = server.address() as AddressInfo;
	const urls = lanVoiceUrls(certificate.hostnames, certificate.ipAddresses, address.port);
	diagnostics.write("server", "listening", { address, urls });

	return {
		ownerSessionId: options.ownerSessionId,
		urls,
		logPath: diagnostics.path,
		async close() {
			if (closing) return;
			closing = true;
			clearInterval(heartbeat);
			const activeConversation = conversation;
			const peer = upstreamPeer;
			clearUpstream();
			if (activeConversation) await options.voice.stopConversation(activeConversation, { announce: true });
			else await peer?.close();
			clients.close();
			await dictation.close();
			await new Promise<void>((resolve) => webSockets.close(() => resolve()));
			await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
			await diagnostics.close();
		},
	};
}

function configureServerDiagnostics(server: HttpsServer, write: (source: "server", event: string, data?: unknown) => void): void {
	server.keepAliveTimeout = 20_000;
	server.on("tlsClientError", (error, socket) => write("server", "tls.client_error", { error, remoteAddress: socket.remoteAddress, remotePort: socket.remotePort }));
	server.on("clientError", (error, socket) => { write("server", "http.client_error", { error }); socket.destroy(); });
	server.on("error", (error) => write("server", "https.error", error));
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
