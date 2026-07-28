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
import { LAN_VOICE_WEB_UI } from "./web-ui.ts";

const PORT = 43_120;
const MAX_SDP_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 300 * 1024;
const HEARTBEAT_MS = 15_000;

export interface CodexLanVoiceServer {
	readonly ownerSessionId: string;
	readonly urls: string[];
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
	const certificate = resolveLanVoiceCertificate(options.certificateAgentDir);
	let eventResponse: ServerResponse | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let peer: LanVoiceBrowserPeer | undefined;
	let conversation: CodexRealtimeConversation | undefined;
	let closing = false;

	const ownerIsActive = () =>
		options.ctx.sessionManager.getSessionId() === options.ownerSessionId;
	const sendBrowserCommand = (command: LanVoiceBrowserCommand): void => {
		if (!eventResponse || eventResponse.writableEnded)
			throw new Error("LAN voice browser is not connected");
		eventResponse.write(`data: ${JSON.stringify(command)}\n\n`);
	};
	const stopConversation = async (): Promise<void> => {
		const activeConversation = conversation;
		const activePeer = peer;
		conversation = undefined;
		peer = undefined;
		if (activeConversation) {
			await options.voice.stopConversation(activeConversation, {
				announce: true,
			});
		} else if (activePeer) {
			await activePeer.close();
			await options.voice.stop({ announce: true });
		}
	};

	let server!: HttpsServer;
	server = createServer(
		{ cert: certificate.cert, key: certificate.key },
		(request, response) => {
			void handleRequest(request, response, {
				ownerIsActive,
				get closing() {
					return closing;
				},
				get eventResponse() {
					return eventResponse;
				},
				setEventResponse(next) {
					eventResponse = next;
					if (heartbeat) clearInterval(heartbeat);
					heartbeat = next
						? setInterval(() => {
								if (!next.writableEnded) next.write(": keepalive\n\n");
							}, HEARTBEAT_MS)
						: undefined;
				},
				get peer() {
					return peer;
				},
				async startCall(offer) {
					await stopConversation();
					if (!eventResponse || eventResponse.writableEnded)
						throw new Error("Open the LAN voice page before starting a call");
					const browserPeer = new LanVoiceBrowserPeer(
						offer,
						sendBrowserCommand,
					);
					peer = browserPeer;
					const started = await options.voice.startRealtimeWithPeer(
						options.ctx,
						options.getConfig(),
						browserPeer,
					);
					if (!started) {
						if (peer === browserPeer) peer = undefined;
						await browserPeer.close();
						throw new Error("Codex voice could not start");
					}
					conversation = started;
					return browserPeer.takeAnswer();
				},
				stopConversation,
			});
		},
	);
	server.keepAliveTimeout = 20_000;
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

	return {
		ownerSessionId: options.ownerSessionId,
		urls,
		async close() {
			if (closing) return;
			closing = true;
			await stopConversation();
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = undefined;
			eventResponse?.end();
			eventResponse = undefined;
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			});
		},
	};
}

interface RequestHandlers {
	ownerIsActive(): boolean;
	readonly closing: boolean;
	readonly eventResponse: ServerResponse | undefined;
	setEventResponse(response: ServerResponse | undefined): void;
	readonly peer: LanVoiceBrowserPeer | undefined;
	startCall(offer: string): Promise<string>;
	stopConversation(): Promise<void>;
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	handlers: RequestHandlers,
): Promise<void> {
	try {
		const path = new URL(request.url ?? "/", "https://lan-voice.local")
			.pathname;
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
			sendJson(response, 409, {
				error:
					"The Pi session that started this voice server is no longer active",
			});
			return;
		}
		if (request.method === "GET" && path === "/api/events") {
			await handlers.stopConversation();
			handlers.eventResponse?.end();
			response.writeHead(200, {
				"cache-control": "no-store",
				connection: "keep-alive",
				"content-type": "text/event-stream; charset=utf-8",
				"x-accel-buffering": "no",
			});
			response.write("event: ready\ndata: {}\n\n");
			handlers.setEventResponse(response);
			response.once("close", () => {
				if (handlers.eventResponse === response) {
					handlers.setEventResponse(undefined);
					void handlers.stopConversation();
				}
			});
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		if (path === "/api/stop") {
			await handlers.stopConversation();
			sendJson(response, 200, { ok: true });
			return;
		}
		const body = await readJson(request);
		if (path === "/api/call") {
			const offer = boundedString(body["offer"], MAX_SDP_BYTES);
			if (!offer)
				throw new RequestError(400, "A bounded WebRTC offer is required");
			let disconnected = false;
			const stopOnDisconnect = () => {
				if (response.writableEnded) return;
				disconnected = true;
				void handlers.stopConversation();
			};
			response.once("close", stopOnDisconnect);
			try {
				const answer = await handlers.startCall(offer);
				if (disconnected || response.destroyed) {
					await handlers.stopConversation();
					return;
				}
				sendJson(response, 200, { answer });
			} finally {
				response.off("close", stopOnDisconnect);
			}
			return;
		}
		if (path === "/api/data") {
			if (
				!("message" in body) ||
				jsonBytes(body["message"]) > MAX_MESSAGE_BYTES
			)
				throw new RequestError(400, "Invalid realtime data message");
			if (!handlers.peer)
				throw new RequestError(409, "No LAN voice call is active");
			handlers.peer.receiveData(body["message"]);
			sendJson(response, 200, { ok: true });
			return;
		}
		if (path === "/api/state") {
			const state = boundedString(body["state"], 128);
			if (!state) throw new RequestError(400, "Invalid peer state");
			if (!handlers.peer)
				throw new RequestError(409, "No LAN voice call is active");
			handlers.peer.receiveState(state);
			sendJson(response, 200, { ok: true });
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		const status = error instanceof RequestError ? error.status : 500;
		const message = error instanceof Error ? error.message : String(error);
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

function jsonBytes(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value));
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
