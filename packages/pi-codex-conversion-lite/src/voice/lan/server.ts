import { createServer, type Server as HttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import {
	LanVoiceBrowserPeer,
	type LanVoiceBrowserCommand,
} from "./browser-peer.ts";
import { resolveLanVoiceCertificate } from "./certificate.ts";
import { createLanVoiceDiagnostics, type LanVoiceDiagnostics } from "./diagnostics.ts";
import { LAN_VOICE_WEB_UI } from "./web-ui.ts";

const PORT = 43_120;
const MAX_SDP_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 300 * 1024;
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
	ownerSessionId: string;
	port?: number | undefined;
	certificateAgentDir: string;
}): Promise<CodexLanVoiceServer> {
	const diagnostics = createLanVoiceDiagnostics(options.certificateAgentDir);
	const certificate = resolveLanVoiceCertificate(options.certificateAgentDir);
	diagnostics.write("server", "starting", {
		ownerSessionId: options.ownerSessionId,
		port: options.port ?? PORT,
		certificate: {
			hostnames: certificate.hostnames,
			ipAddresses: certificate.ipAddresses,
		},
	});
	const eventResponses = new Map<string, ServerResponse>();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let peer: LanVoiceBrowserPeer | undefined;
	let conversation: CodexRealtimeConversation | undefined;
	let activeClientId: string | undefined;
	let closing = false;

	const ownerIsActive = () =>
		options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	const sendBrowserCommand = (command: LanVoiceBrowserCommand): void => {
		const eventResponse = activeClientId ? eventResponses.get(activeClientId) : undefined;
		if (!eventResponse || eventResponse.writableEnded)
			throw new Error("LAN voice browser is not connected");
		diagnostics.write("server", "sse.command", { clientId: activeClientId, command });
		eventResponse.write(`data: ${JSON.stringify(command)}\n\n`);
	};
	const stopConversation = async (): Promise<void> => {
		const activeConversation = conversation;
		const activePeer = peer;
		const stoppingClientId = activeClientId;
		conversation = undefined;
		peer = undefined;
		diagnostics.write("server", "conversation.stop", {
			clientId: stoppingClientId,
			hadConversation: Boolean(activeConversation),
			hadPeer: Boolean(activePeer),
		});
		if (activeConversation) {
			await options.voice.stopConversation(activeConversation, {
				announce: true,
			});
		} else if (activePeer) {
			await activePeer.close();
			await options.voice.stop({ announce: true });
		}
		if (activeClientId === stoppingClientId) activeClientId = undefined;
	};

	let server!: HttpsServer;
	server = createServer(
		{ cert: certificate.cert, key: certificate.key },
		(request, response) => {
			void handleRequest(request, response, {
				diagnostics,
				ownerIsActive,
				get closing() {
					return closing;
				},
				connectEvents(clientId, next) {
					const previous = eventResponses.get(clientId);
					eventResponses.set(clientId, next);
					diagnostics.write("server", "sse.set", {
						clientId,
						replacing: Boolean(previous && previous !== next),
						clients: eventResponses.size,
					});
					previous?.end();
				},
				disconnectEvents(clientId, response) {
					if (eventResponses.get(clientId) !== response) return false;
					eventResponses.delete(clientId);
					return activeClientId === clientId;
				},
				get peer() {
					return peer;
				},
				activeClientIs: (clientId) => activeClientId === clientId,
				async startCall(clientId, offer) {
					diagnostics.write("server", "call.start", { clientId, offer });
					await stopConversation();
					const eventResponse = eventResponses.get(clientId);
					if (!eventResponse || eventResponse.writableEnded)
						throw new Error("Open the LAN voice page before starting a call");
					activeClientId = clientId;
					const browserPeer = new LanVoiceBrowserPeer(
						offer,
						sendBrowserCommand,
						diagnostics,
					);
					peer = browserPeer;
					const started = await options.voice.startRealtimeWithPeer(
						options.ctx,
						options.getConfig(),
						browserPeer,
					);
					if (!started) {
						diagnostics.write("server", "call.start_failed", { clientId });
						if (peer === browserPeer) peer = undefined;
						await browserPeer.close();
						if (activeClientId === clientId) activeClientId = undefined;
						throw new Error("Codex voice could not start");
					}
					conversation = started;
					const answer = browserPeer.takeAnswer();
					diagnostics.write("server", "call.started", { answer });
					return answer;
				},
				stopConversation,
			});
		},
	);
	server.keepAliveTimeout = 20_000;
	heartbeat = setInterval(() => {
		for (const response of eventResponses.values()) {
			if (!response.writableEnded) response.write(": keepalive\n\n");
		}
	}, HEARTBEAT_MS);
	server.on("tlsClientError", (error, socket) => {
		diagnostics.write("server", "tls.client_error", {
			error,
			remoteAddress: socket.remoteAddress,
			remotePort: socket.remotePort,
		});
	});
	server.on("clientError", (error, socket) => {
		diagnostics.write("server", "http.client_error", { error });
		socket.destroy();
	});
	server.on("error", (error) => diagnostics.write("server", "https.error", error));
	await listen(server, options.port ?? PORT);
	const address = server.address() as AddressInfo;
	const displayHosts = [
		...certificate.hostnames.filter((value) => value !== "localhost"),
		...certificate.ipAddresses.filter((value) => value !== "127.0.0.1"),
	];
	if (displayHosts.length === 0) displayHosts.push("localhost");
	const urls = [
		...new Set(displayHosts.map((host) => `https://${host}:${address.port}`)),
	];
	diagnostics.write("server", "listening", { address, urls });

	return {
		ownerSessionId: options.ownerSessionId,
		urls,
		logPath: diagnostics.path,
		async close() {
			if (closing) return;
			closing = true;
			diagnostics.write("server", "closing");
			await stopConversation();
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = undefined;
			for (const response of eventResponses.values()) response.end();
			eventResponses.clear();
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			});
			diagnostics.write("server", "closed");
		},
	};
}

interface RequestHandlers {
	readonly diagnostics: LanVoiceDiagnostics;
	ownerIsActive(): boolean;
	readonly closing: boolean;
	connectEvents(clientId: string, response: ServerResponse): void;
	disconnectEvents(clientId: string, response: ServerResponse): boolean;
	readonly peer: LanVoiceBrowserPeer | undefined;
	activeClientIs(clientId: string): boolean;
	startCall(clientId: string, offer: string): Promise<string>;
	stopConversation(): Promise<void>;
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	handlers: RequestHandlers,
): Promise<void> {
	let path = "/";
	try {
		const url = new URL(request.url ?? "/", "https://lan-voice.local");
		path = url.pathname;
		if (path !== "/api/debug") {
			handlers.diagnostics.write("server", "http.request", {
				method: request.method,
				path,
				remoteAddress: request.socket.remoteAddress,
				remotePort: request.socket.remotePort,
				userAgent: request.headers["user-agent"],
			});
		}
		if (request.method === "GET" && path === "/") {
			response.writeHead(200, {
				"cache-control": "no-store",
				"content-security-policy":
					"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
				"content-type": "text/html; charset=utf-8",
				"permissions-policy": "microphone=(self), camera=()",
				"x-content-type-options": "nosniff",
			});
			response.end(LAN_VOICE_WEB_UI);
			return;
		}
		if (!handlers.ownerIsActive() || handlers.closing) {
			handlers.diagnostics.write("server", "request.rejected_owner", { path });
			sendJson(response, 409, {
				error:
					"The Pi session that started this voice server is no longer active",
			});
			return;
		}
		if (request.method === "GET" && path === "/api/events") {
			const clientId = boundedString(url.searchParams.get("client"), 128);
			if (!clientId) throw new RequestError(400, "A browser client ID is required");
			handlers.diagnostics.write("server", "sse.open", { clientId });
			response.writeHead(200, {
				"cache-control": "no-store",
				connection: "keep-alive",
				"content-type": "text/event-stream; charset=utf-8",
				"x-accel-buffering": "no",
			});
			response.write("event: ready\ndata: {}\n\n");
			handlers.connectEvents(clientId, response);
			response.once("close", () => {
				handlers.diagnostics.write("server", "sse.close", {
					clientId,
					writableEnded: response.writableEnded,
					destroyed: response.destroyed,
				});
				if (handlers.disconnectEvents(clientId, response)) void handlers.stopConversation();
			});
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		if (path === "/api/stop") {
			const body = await readJson(request);
			const clientId = requiredClientId(body);
			handlers.diagnostics.write("server", "stop.request", { clientId });
			if (handlers.activeClientIs(clientId)) await handlers.stopConversation();
			sendJson(response, 200, { ok: true });
			return;
		}
		const body = await readJson(request);
		if (path === "/api/debug") {
			const clientId = requiredClientId(body);
			const event = boundedString(body["event"], 256);
			if (!event) throw new RequestError(400, "Invalid browser diagnostic event");
			handlers.diagnostics.write("browser", event, { clientId, data: body["data"] });
			sendJson(response, 200, { ok: true });
			return;
		}
		if (path === "/api/call") {
			handlers.diagnostics.write("server", "call.request", body);
			const clientId = requiredClientId(body);
			const offer = boundedString(body["offer"], MAX_SDP_BYTES);
			if (!offer)
				throw new RequestError(400, "A bounded WebRTC offer is required");
			let disconnected = false;
			const stopOnDisconnect = () => {
				if (response.writableEnded) return;
				disconnected = true;
				handlers.diagnostics.write("server", "call.request_disconnected", {
					destroyed: response.destroyed,
				});
				void handlers.stopConversation();
			};
			response.once("close", stopOnDisconnect);
			try {
				const answer = await handlers.startCall(clientId, offer);
				if (disconnected || response.destroyed) {
					handlers.diagnostics.write("server", "call.answer_abandoned", { answer });
					await handlers.stopConversation();
					return;
				}
				sendJson(response, 200, { answer });
				handlers.diagnostics.write("server", "call.answer_sent", { answer });
			} finally {
				response.off("close", stopOnDisconnect);
			}
			return;
		}
		if (path === "/api/data") {
			handlers.diagnostics.write("server", "data.request", body);
			const clientId = requiredClientId(body);
			if (
				!("message" in body) ||
				jsonBytes(body["message"]) > MAX_MESSAGE_BYTES
			)
				throw new RequestError(400, "Invalid realtime data message");
			if (!handlers.peer || !handlers.activeClientIs(clientId))
				throw new RequestError(409, "No LAN voice call is active");
			handlers.peer.receiveData(body["message"]);
			sendJson(response, 200, { ok: true });
			return;
		}
		if (path === "/api/state") {
			handlers.diagnostics.write("server", "state.request", body);
			const clientId = requiredClientId(body);
			const state = boundedString(body["state"], 128);
			if (!state) throw new RequestError(400, "Invalid peer state");
			if (!handlers.peer || !handlers.activeClientIs(clientId))
				throw new RequestError(409, "No LAN voice call is active");
			handlers.peer.receiveState(state);
			sendJson(response, 200, { ok: true });
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		const status = error instanceof RequestError ? error.status : 500;
		const message = error instanceof Error ? error.message : String(error);
		handlers.diagnostics.write("server", "request.error", {
			method: request.method,
			path,
			status,
			error,
		});
		if (!response.headersSent) sendJson(response, status, { error: message });
		else response.end();
	}
}

class RequestError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function listen(server: HttpsServer, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "0.0.0.0");
	});
}

async function readJson(
	request: IncomingMessage,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MAX_REQUEST_BYTES)
			throw new RequestError(413, "LAN voice request is too large");
		chunks.push(buffer);
	}
	try {
		const value = JSON.parse(
			Buffer.concat(chunks).toString("utf8") || "{}",
		) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw new RequestError(400, "LAN voice request must be a JSON object");
	}
}

function sendJson(
	response: ServerResponse,
	status: number,
	value: unknown,
): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

function boundedString(value: unknown, maxBytes: number): string | undefined {
	return typeof value === "string" &&
		value.length > 0 &&
		Buffer.byteLength(value) <= maxBytes
		? value
		: undefined;
}

function requiredClientId(body: Record<string, unknown>): string {
	const clientId = boundedString(body["clientId"], 128);
	if (!clientId) throw new RequestError(400, "A browser client ID is required");
	return clientId;
}

function jsonBytes(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value));
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
