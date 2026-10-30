import { randomUUID, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { WebSocketServer } from "ws";
import {
	DEFAULT_GIPPITY_LAN_PORT,
	type GippityControlConfig,
} from "../../config.ts";
import { getGippityControlConfigPath } from "../../config-store.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { PreparedRealtimeContext } from "../controller/start.ts";
import type { CodexVoiceController } from "../controller.ts";
import { hasRealtimeWebSearch } from "../realtime-web-search.ts";
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
import { LAN_REMOTE_CLIENT_SCRIPT } from "./client-sdk-script.ts";
import {
	createLanConversationStarter,
	type LanConversationState,
} from "./conversation-start.ts";
import { resolveLanRemoteCustomApp } from "./custom-app.ts";
import { LanVoiceDictation } from "./dictation.ts";
import { createLanRemoteDiscovery } from "./discovery.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "./draft.ts";
import { handleLanVoiceHttpRequest } from "./http-handler.ts";
import { boundedString, isLanVoiceOriginAllowed } from "./http-protocol.ts";
import type { GippityRemoteApps } from "./remote-app.ts";
import { remoteJsonValue } from "./remote-json.ts";
import {
	decodeLanRemoteRpcRequest,
	invokeLanRemoteRpc,
	lanRemoteRpcError,
} from "./rpc.ts";
import {
	collectFailures,
	configureServer,
	lanVoiceUrls,
	listen,
} from "./server-runtime.ts";
import { createLanVoiceSettings } from "./settings.ts";
import { LanTakeoverArrival } from "./takeover.ts";
import { createLanVoiceWebUi } from "./web-ui.ts";

const HEARTBEAT_MS = 15_000;

export interface CodexLanVoiceServer {
	readonly ownerSessionId: string;
	readonly urls: string[];
	readonly customWebAppReady: boolean;
	readonly hasConversation: boolean;
	readonly browserAttached: boolean;
	readonly port: number;
	readonly certificateFingerprint: string;
	acknowledgeTakeover(token: string): Promise<void>;
	proveTakeover(verify: (value: unknown) => Promise<unknown>): Promise<void>;
	releaseForTakeover(): Promise<void>;
	agentStarted(): void;
	agentSettled(text?: string): void;
	uiPromptStarted(title?: string): void;
	uiPromptEnded(agentRunning: boolean): void;
	piEvent(event: string, data: unknown): void;
	close(): Promise<void>;
}

export async function startCodexLanVoiceServer(options: {
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	getConfig: () => GippityControlConfig;
	voice: CodexVoiceController;
	resolveAuth(): Promise<CodexVoiceAuth>;
	sendUserMessage(text: string): void;
	ownerSessionId: string;
	port?: number | undefined;
	certificateAgentDir: string;
	remoteApps: GippityRemoteApps;
	certificate?: LanVoiceCertificate;
	takeoverToken?: string;
	arrival?: {
		prepared: PreparedRealtimeContext;
		inputMuted: boolean;
		alternateVoice: boolean;
	};
}): Promise<CodexLanVoiceServer> {
	const settings = createLanVoiceSettings(options.ctx, options.getConfig, () =>
		hasRealtimeWebSearch(options.pi),
	);
	const resolveWebApp = (config: GippityControlConfig) => {
		const customWebApp = config.lan.customWebApp;
		const customApp =
			customWebApp && config.lan.customWebAppPath
				? resolveLanRemoteCustomApp(
						config.lan.customWebAppPath,
						options.ctx.cwd,
					)
				: undefined;
		return {
			customWebApp,
			customApp,
			discovery: createLanRemoteDiscovery({
				customWebApp,
				customWebAppPath: customApp?.root,
				configPath: getGippityControlConfigPath(),
				apps: options.remoteApps.apps(),
			}),
		};
	};
	const initialConfig = options.getConfig();
	const initialWebApp = resolveWebApp(initialConfig);
	const certificate =
		options.certificate ??
		(await resolveLanVoiceCertificate(options.certificateAgentDir));
	const ownerIsActive = () =>
		options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	const conversation: LanConversationState = {};
	let closing = false;
	let clients!: LanVoiceBrowserClients;
	const arrival = new LanTakeoverArrival(
		options.takeoverToken,
		options.arrival,
	);
	let takeoverProof: string | undefined;
	const activity = new LanVoiceActivity({
		initialWorking: !options.ctx.isIdle(),
		publish: (message) => clients.broadcastControl(message),
	});
	const draft = new LanVoiceDraft({
		publish: (message) => clients.broadcastControl(message),
		sendMessage: (text) =>
			conversation.transferred
				? conversation.transferred.sendText(text)
				: options.sendUserMessage(text),
	});
	const dictation = new LanVoiceDictation({
		resolveAuth: options.resolveAuth,
		onError: (clientId, error) =>
			clients.sendControl(clientId, { type: "error", message: error.message }),
	});

	const ensureConversation = createLanConversationStarter({
		state: conversation,
		ctx: options.ctx,
		voice: options.voice,
		getConfig: () => settings.getConfig(),
		arrival,
		clients: () => clients,
		activity,
	});
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
			const current = conversation.activeConversation;
			if (active) {
				if (current?.conversation)
					options.voice.setConversationInputActive(current.conversation, true);
				return;
			}
			const remote = conversation.transferred;

			const plan = conversation.realtimePlan;
			conversation.realtimePlan = undefined;
			conversation.activeConversation = undefined;
			if (remote) await remote.stop();
			else if (plan)
				await options.voice.stopRealtimeWithPeerPlan(plan, { announce: true });
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
			if (!conversation.transferred)
				options.voice.setInputTooQuiet(inputTooQuiet);
			clients.broadcastControl({
				type: "microphone",
				state: inputTooQuiet ? "too-quiet" : "ok",
			});
		},
		onConversationAudio(pcm) {
			conversation.activeConversation?.peer.sendAudio(pcm);
		},
		onDictationAudio: (clientId, pcm) => dictation.append(clientId, pcm),
	});
	const removeInputMuteListener = options.voice.onInputMuteChange((muted) => {
		if (conversation.transferred) return;
		if (muted) clients.resetConversationInputLevel();
		clients.broadcastControl({ type: "mute", muted });
	});
	const removeRemoteAppListener = options.remoteApps.onMessage((message) =>
		clients.broadcastControl(message),
	);

	const server = createServer(
		{ cert: certificate.cert, key: certificate.key },
		(request, response) => {
			if (
				request.method === "GET" &&
				request.url?.startsWith("/api/takeover-proof?")
			) {
				const proofUrl = new URL(request.url, "https://lan-voice.local");
				const valid =
					isLanVoiceOriginAllowed(request) &&
					takeoverProof !== undefined &&
					proofUrl.searchParams.get("token") === takeoverProof;
				response.writeHead(valid ? 200 : 404, {
					"content-type": "text/plain",
					"cache-control": "no-store",
				});
				response.end(valid ? takeoverProof : "Not found");
				return;
			}
			void handleLanVoiceHttpRequest(request, response, {
				takeoverToken: options.takeoverToken,
				activity,
				settings: settings.settings,
				configureSettings: settings.configureSettings,
				clients,
				draft,
				sessionSnapshot: () => conversation.transferred?.snapshot(),
				inputMuted: () =>
					conversation.transferred?.controls.inputMuted ??
					options.voice.inputMuted,
				remoteAppSnapshot: () => options.remoteApps.snapshot(),
				remoteAppRoute: (path) => options.remoteApps.route(path),
				renderManifest: () => createLanVoiceWebManifest(options.ctx.ui.theme),
				renderPage: () => createLanVoiceWebUi(options.ctx.ui.theme),
				clientScript: () => LAN_REMOTE_CLIENT_SCRIPT,
				webApp: () => resolveWebApp(options.getConfig()),
				async rpc(body) {
					try {
						if (conversation.transferred)
							return await conversation.transferred.rpc(body);
						const rpc = decodeLanRemoteRpcRequest(body);
						return {
							id: rpc.id ?? null,
							ok: true,
							result: await invokeLanRemoteRpc({
								request: rpc,
								pi: options.pi,
								ctx: options.ctx,
							}),
						};
					} catch (error) {
						const id = body["id"];
						return {
							id:
								typeof id === "string" || typeof id === "number" || id === null
									? id
									: null,
							ok: false,
							error: lanRemoteRpcError(error),
						};
					}
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
		await listen(
			server,
			options.port ?? initialConfig.lan.port ?? DEFAULT_GIPPITY_LAN_PORT,
		);
	} catch (error) {
		removeInputMuteListener();
		removeRemoteAppListener();
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
		removeRemoteAppListener();
		conversation.conversationStart?.abort.abort();
		conversation.conversationStart = undefined;
		clearInterval(heartbeat);
		const clientsClosing = clients.close();
		const failures: unknown[] = [];
		await collectFailures([clientsClosing, dictation.close()], failures);
		const remote = conversation.transferred;
		remote?.detach();
		conversation.transferred = undefined;
		if (remote) await collectFailures([remote.stop()], failures);
		const remainingPlan = conversation.realtimePlan;
		conversation.realtimePlan = undefined;
		conversation.activeConversation = undefined;
		if (remainingPlan && !remote) {
			await collectFailures(
				[
					options.voice.stopRealtimeWithPeerPlan(remainingPlan, {
						announce: true,
					}),
				],
				failures,
			);
		}
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
		customWebAppReady: Boolean(initialWebApp.customApp),
		get hasConversation() {
			return Boolean(conversation.activeConversation?.conversation);
		},
		get browserAttached() {
			return !closing && clients.hasAudioClients();
		},
		port: address.port,
		certificateFingerprint: new X509Certificate(certificate.cert)
			.fingerprint256,
		acknowledgeTakeover: (token) => clients.takeover(token),
		async proveTakeover(verify) {
			if (takeoverProof)
				throw new Error("A LAN listener proof is already pending");
			const token = randomUUID();
			takeoverProof = token;
			try {
				await verify({ port: address.port, token });
			} finally {
				takeoverProof = undefined;
			}
		},
		async releaseForTakeover() {
			closePromise ??= closeServer();
			await closePromise;
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
			!conversation.transferred &&
			(agentRunning ? activity.working() : activity.settled()),
		piEvent(event, data) {
			if (
				conversation.transferred ||
				!ownerIsActive() ||
				!clients.hasEventClients()
			)
				return;
			let serialized: unknown;
			try {
				serialized = remoteJsonValue(data);
			} catch (error) {
				serialized = {
					serializationError:
						error instanceof Error ? error.message : String(error),
				};
			}
			clients.broadcastControl({
				type: "pi.event",
				event,
				data: serialized,
			});
		},
		close() {
			closePromise ??= closeServer();
			return closePromise;
		},
	};
}
