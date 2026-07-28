import { createServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer } from "ws";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import { LanVoiceActivity } from "./activity.ts";
import { LanVoiceBridgePeer } from "./bridge-peer.ts";
import { LanVoiceBrowserClients, MAX_PCM_BYTES } from "./browser-clients.ts";
import { resolveLanVoiceCertificate } from "./certificate.ts";
import { createLanVoiceDiagnostics } from "./diagnostics.ts";
import { LanVoiceDictation } from "./dictation.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "./draft.ts";
import { boundedString, handleLanVoiceHttpRequest } from "./http-handler.ts";
import { createLanVoiceWebUi } from "./web-ui.ts";

const PORT = 43_120;
const HEARTBEAT_MS = 15_000;

export interface CodexLanVoiceServer {
	readonly ownerSessionId: string;
	readonly urls: string[];
	readonly logPath: string;
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
	const diagnostics = createLanVoiceDiagnostics(options.certificateAgentDir);
	const ownerIsActive = () => options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	let upstreamPeer: LanVoiceBridgePeer | undefined;
	let conversation: CodexRealtimeConversation | undefined;
	let closing = false;
	let clients!: LanVoiceBrowserClients;
	const activity = new LanVoiceActivity({
		diagnostics,
		initialWorking: !options.ctx.isIdle(),
		publish: (message) => clients.broadcastControl(message),
	});
	const draft = new LanVoiceDraft({
		diagnostics,
		publish: (message) => clients.broadcastControl(message),
		sendMessage: options.sendUserMessage,
	});
	const dictation = new LanVoiceDictation({
		resolveAuth: options.resolveAuth,
		diagnostics,
		onError: (clientId, error) => clients.sendControl(clientId, { type: "error", message: error.message }),
	});

	const clearUpstream = (peer?: LanVoiceBridgePeer): void => {
		if (peer && upstreamPeer !== peer) return;
		upstreamPeer = undefined;
		conversation = undefined;
	};
	const ensureConversation = async (): Promise<void> => {
		if (conversation && upstreamPeer) return;
		let peer!: LanVoiceBridgePeer;
		peer = new LanVoiceBridgePeer(diagnostics, (pcm) => clients.sendConversationAudio(pcm));
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
					diagnostics.write("server", "draft.finish_conflict", { clientId });
				}
			}
			if (transcript) draft.insertTranscript(clientId, transcript, insertion);
		},
		cancelDictation: (clientId) => dictation.cancel(clientId),
		onConversationActivity(active) {
			const activeConversation = conversation;
			if (activeConversation) options.voice.setConversationInputActive(activeConversation, active);
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
			activity,
			clients,
			draft,
			renderPage: () => createLanVoiceWebUi(options.ctx.ui.theme),
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
		const clientsClosing = clients.close();
		webSockets.close();
		server.closeAllConnections();
		await Promise.allSettled([clientsClosing, dictation.close(), upstreamPeer?.close()]);
		await diagnostics.close();
		throw error;
	}
	const heartbeat = setInterval(() => clients.heartbeat(), HEARTBEAT_MS);
	const address = server.address() as AddressInfo;
	const urls = lanVoiceUrls(certificate.hostnames, certificate.ipAddresses, address.port);
	diagnostics.write("server", "listening", { address, urls });
	let closePromise: Promise<void> | undefined;
	const closeServer = async (): Promise<void> => {
		closing = true;
		clearInterval(heartbeat);
		const firstConversation = conversation;
		const firstPeer = upstreamPeer;
		const clientsClosing = clients.close();
		const upstreamClosing = firstConversation
			? options.voice.stopConversation(firstConversation, { announce: true })
			: firstPeer?.close() ?? Promise.resolve();
		const failures: unknown[] = [];
		await collectFailures([clientsClosing, dictation.close(), upstreamClosing], failures);
		const remainingConversation = conversation;
		const remainingPeer = upstreamPeer;
		clearUpstream();
		if (remainingConversation && remainingConversation !== firstConversation) {
			await collectFailures([options.voice.stopConversation(remainingConversation, { announce: true })], failures);
		} else if (remainingPeer && remainingPeer !== firstPeer) {
			await collectFailures([remainingPeer.close()], failures);
		}
		await collectFailures([
			new Promise<void>((resolve) => webSockets.close(() => resolve())),
			new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
		], failures);
		await collectFailures([diagnostics.close()], failures);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "LAN voice server cleanup failed");
	};

	return {
		ownerSessionId: options.ownerSessionId,
		urls,
		logPath: diagnostics.path,
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
