import { createLanConversationStarter, type LanConversationState } from "./conversation-start.ts";
import { randomUUID, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer } from "ws";
import type { CodexVoiceAuth } from "../auth.ts";
import type {
	PreparedRealtimeContext,
} from "../controller/start.ts";
import type { CodexVoiceController } from "../controller.ts";
import { LanVoiceActivity } from "./activity.ts";
import { createLanVoiceWebManifest } from "./app-assets.ts";
import {
	LanVoiceBrowserClients,
	MAX_CONTROL_BYTES,
} from "./browser-clients.ts";
import {
	type LanVoiceCertificate,
	resolveLanVoiceCertificate,
} from "./certificate.ts";
import { LanVoiceDictation } from "./dictation.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "./draft.ts";
import { handleLanVoiceHttpRequest } from "./http-handler.ts";
import { boundedString, isLanVoiceOriginAllowed } from "./http-protocol.ts";
import {
	collectFailures,
	configureServer,
	lanVoiceUrls,
	listen,
} from "./server-runtime.ts";
import type { LanVoiceSettings } from "./settings-contract.ts";
import { LanTakeoverArrival } from "./takeover.ts";
import { createLanVoiceWebUi } from "./web-ui.ts";

const PORT = 43_120;
const HEARTBEAT_MS = 15_000;

export interface CodexLanVoiceServer {
	readonly ownerSessionId: string;
	readonly urls: string[];
	readonly port: number;
	readonly certificateFingerprint: string;
	hasActiveConversation(): boolean;
	browserAttached(): boolean;
	verifyTakeoverHost(
		verify: (proof: { port: number; token: string }) => Promise<void>,
	): Promise<void>;
	notifyTakeover(token: string): Promise<void>;
	takeover(): Promise<void>;
	agentStarted(): void;
	agentSettled(text?: string): void;
	uiPromptStarted(title?: string): void;
	uiPromptEnded(agentRunning: boolean): void;
	close(): Promise<void>;
}

export async function startCodexLanVoiceServer(options: {
	ctx: ExtensionContext;
	settings: LanVoiceSettings;
	voice: CodexVoiceController;
	resolveAuth(): Promise<CodexVoiceAuth>;
	sendUserMessage(text: string): void;
	ownerSessionId: string;
	port?: number | undefined;
	certificateAgentDir: string;
	certificate?: LanVoiceCertificate;
	takeover?: {
		token: string;
		prepared: PreparedRealtimeContext;
		inputMuted: boolean;
		alternateVoice: boolean;
	};
}): Promise<CodexLanVoiceServer> {
	const { settings } = options;
	const certificate =
		options.certificate ??
		(await resolveLanVoiceCertificate(options.certificateAgentDir));
	const arrival = new LanTakeoverArrival(
		options.takeover?.token,
		options.takeover,
	);
	const ownerIsActive = () =>
		options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	const conversation: LanConversationState = {};
	let closing = false;
	let proofToken: string | undefined;
	let clients!: LanVoiceBrowserClients;
	const activity = new LanVoiceActivity({
		initialWorking: !options.ctx.isIdle(),
		publish: (message) => clients.broadcastControl(message),
	});
	const draft = new LanVoiceDraft({
		publish: (message) => clients.broadcastControl(message),
		sendMessage: (text) =>
			conversation.transferred ? conversation.transferred.sendText(text) : options.sendUserMessage(text),
	});
	const dictation = new LanVoiceDictation({
		resolveAuth: options.resolveAuth,
		onError: (clientId, error) =>
			clients.sendControl(clientId, { type: "error", message: error.message }),
	});

	const ensureConversation = createLanConversationStarter({
 state: conversation, ctx: options.ctx, voice: options.voice,
 getConfig: () => settings.getConfig(), arrival, clients: () => clients, activity,
 });
	clients = new LanVoiceBrowserClients(
		{
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
				const current = conversation.activeConversation;
				if (active) {
					if (current?.conversation)
						options.voice.setConversationInputActive(
							current.conversation,
							true,
						);
					return;
				}
				const remote = conversation.transferred;
				if (closing && remote) return;
				conversation.conversationStart?.abort.abort();
				const plan = conversation.realtimePlan;
				conversation.realtimePlan = undefined;
				conversation.activeConversation = undefined;
				if (remote) await remote.stopCall();
				else if (plan)
					await options.voice.stopRealtimeWithPeerPlan(plan, {
						announce: true,
					});
			},
			conversationMuted: () =>
				conversation.transferred?.controls.inputMuted ?? options.voice.inputMuted,
			onConversationMute(muted) {
				if (conversation.transferred) {
					conversation.transferred.controls.setInputMuted(muted);
					return;
				}
				if (!options.voice.setInputMuted(muted))
					throw new Error("Realtime voice is not active");
			},
			onConversationInputTooQuiet(inputTooQuiet) {
				if (!conversation.transferred) options.voice.setInputTooQuiet(inputTooQuiet);
				clients.broadcastControl({
					type: "microphone",
					state: inputTooQuiet ? "too-quiet" : "ok",
				});
			},
			onConversationAudio(pcm) {
				conversation.activeConversation?.peer.sendAudio(pcm);
			},
			onDictationAudio: (clientId, pcm) => dictation.append(clientId, pcm),
		},
		options.takeover?.token,
	);
	const removeInputMuteListener = options.voice.onInputMuteChange((muted) => {
		if (conversation.transferred) return;
		if (muted) clients.resetConversationInputLevel();
		clients.broadcastControl({ type: "mute", muted });
	});

	const server = createServer(
		{ cert: certificate.cert, key: certificate.key },
		(request, response) => {
			const url = new URL(request.url ?? "/", "https://localhost");
			if (url.pathname === "/api/takeover-proof") {
				const token = url.searchParams.get("token");
				if (
					request.method !== "GET" ||
					!proofToken ||
					token !== proofToken ||
					!isLanVoiceOriginAllowed(request)
				) {
					response.writeHead(404).end();
					return;
				}
				proofToken = undefined;
				response
					.writeHead(200, {
						"Content-Type": "text/plain",
						"Cache-Control": "no-store",
					})
					.end(token);
				return;
			}
			void handleLanVoiceHttpRequest(request, response, {
				activity,
				settings: settings.settings,
				configureSettings: settings.configureSettings,
				clients,
				draft,
				sessionSnapshot: () => conversation.transferred?.snapshot(),
				inputMuted: () =>
					conversation.transferred?.controls.inputMuted ?? options.voice.inputMuted,
				renderManifest: () => createLanVoiceWebManifest(options.ctx.ui.theme),
				renderPage: () => createLanVoiceWebUi(options.ctx.ui.theme),
				async rpc(body) {
					if (conversation.transferred) return conversation.transferred.rpc(body);
					throw new Error("RPC is not available in this Pi context");
				},
				ownerIsActive,
				get closing() {
					return closing;
				},
			});
		},
	);
	const webSockets = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_CONTROL_BYTES,
	});
	server.on("upgrade", (request, socket, head) => {
		try {
			const url = new URL(request.url ?? "/", "https://lan-voice.local");
			const clientId = boundedString(url.searchParams.get("client"), 128);
			if (
				url.pathname !== "/api/audio" ||
				!clientId ||
				!ownerIsActive() ||
				closing
			) {
				socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
			if (!isLanVoiceOriginAllowed(request)) {
				socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n", () =>
					socket.destroy(),
				);
				return;
			}
			webSockets.handleUpgrade(request, socket, head, (webSocket) =>
				clients.connectAudio(clientId, webSocket),
			);
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
	const urls = lanVoiceUrls(
		certificate.hostnames,
		certificate.ipAddresses,
		address.port,
	);
	let closePromise: Promise<void> | undefined;
	const closeServer = async (): Promise<void> => {
		closing = true;
		removeInputMuteListener();
		conversation.conversationStart?.abort.abort();
		conversation.conversationStart = undefined;
		clearInterval(heartbeat);
		const clientsClosing = clients.close();
		const failures: unknown[] = [];
		// Closing the binding interrupts pending remote startup before browser drain.
		const remote = conversation.transferred;
		const remoteClosing = remote?.stop();
		await collectFailures(
			[
				clientsClosing,
				dictation.close(),
				...(remoteClosing ? [remoteClosing] : []),
			],
			failures,
		);
		remote?.detach();
		conversation.transferred = undefined;
		const remainingPlan = conversation.realtimePlan;
		conversation.realtimePlan = undefined;
		conversation.activeConversation = undefined;
		if (remainingPlan && !remote)
			await collectFailures(
				[
					options.voice.stopRealtimeWithPeerPlan(remainingPlan, {
						announce: true,
					}),
				],
				failures,
			);
		await collectFailures(
			[
				new Promise<void>((resolve) => webSockets.close(() => resolve())),
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
			],
			failures,
		);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(failures, "LAN voice server cleanup failed");
	};

	return {
		ownerSessionId: options.ownerSessionId,
		urls,
		port: address.port,
		certificateFingerprint: new X509Certificate(certificate.cert)
			.fingerprint256,
		hasActiveConversation: () => Boolean(conversation.activeConversation?.conversation),
		browserAttached: () => clients.browserAttached(),
		async verifyTakeoverHost(verify) {
			const token = randomUUID();
			proofToken = token;
			try {
				await verify({ port: address.port, token });
			} finally {
				if (proofToken === token) proofToken = undefined;
			}
		},
		notifyTakeover: (token) => clients.takeover(token),
		takeover() {
			closing = true;
			closePromise ??= closeServer();
			return closePromise;
		},
		agentStarted: () => {
			if (!conversation.transferred) activity.working();
		},
		agentSettled: (text) => {
			if (!conversation.transferred) activity.settled(text);
		},
		uiPromptStarted: (title) => {
			if (!conversation.transferred) activity.waiting(title);
		},
		uiPromptEnded: (agentRunning) =>
			!conversation.transferred && (agentRunning ? activity.working() : activity.settled()),
		close() {
			closePromise ??= closeServer();
			return closePromise;
		},
	};
}
