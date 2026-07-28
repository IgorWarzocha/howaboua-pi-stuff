import type { IncomingMessage, ServerResponse } from "node:http";
import type { LanVoiceBrowserClients } from "./browser-clients.ts";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";
import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";
import { LAN_VOICE_WEB_UI } from "./web-ui.ts";

const MAX_REQUEST_BYTES = 300 * 1024;

export interface LanVoiceHttpHandlers {
	diagnostics: LanVoiceDiagnostics;
	clients: LanVoiceBrowserClients;
	ownerIsActive(): boolean;
	readonly closing: boolean;
}

export async function handleLanVoiceHttpRequest(
	request: IncomingMessage,
	response: ServerResponse,
	handlers: LanVoiceHttpHandlers,
): Promise<void> {
	let path = "/";
	try {
		const url = new URL(request.url ?? "/", "https://lan-voice.local");
		path = url.pathname;
		if (request.method === "GET" && path === "/") {
			sendText(response, "text/html; charset=utf-8", LAN_VOICE_WEB_UI, true);
			return;
		}
		if (request.method === "GET" && path === "/audio-worklet.js") {
			sendText(response, "text/javascript; charset=utf-8", LAN_VOICE_AUDIO_WORKLET);
			return;
		}
		if (!handlers.ownerIsActive() || handlers.closing) {
			sendJson(response, 409, { error: "The Pi session that started this voice server is no longer active" });
			return;
		}
		if (request.method === "GET" && path === "/api/events") {
			const clientId = boundedString(url.searchParams.get("client"), 128);
			if (!clientId) throw new LanVoiceRequestError(400, "A browser client ID is required");
			response.writeHead(200, {
				"cache-control": "no-store",
				connection: "keep-alive",
				"content-type": "text/event-stream; charset=utf-8",
				"x-accel-buffering": "no",
			});
			response.write("event: ready\ndata: {}\n\n");
			handlers.clients.connectEvents(clientId, response);
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		const body = await readJson(request);
		const clientId = requiredClientId(body);
		if (path === "/api/debug") {
			const event = boundedString(body["event"], 256);
			if (!event) throw new LanVoiceRequestError(400, "Invalid browser diagnostic event");
			handlers.diagnostics.write("browser", event, { clientId, data: body["data"] });
			sendJson(response, 200, { ok: true });
			return;
		}
		if (path === "/api/stop") {
			handlers.clients.release(clientId);
			sendJson(response, 200, { ok: true });
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		const status = error instanceof LanVoiceRequestError ? error.status : 500;
		handlers.diagnostics.write("server", "request.error", { method: request.method, path, status, error });
		if (!response.headersSent) sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
		else response.end();
	}
}

export function boundedString(value: unknown, maxBytes: number): string | undefined {
	return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= maxBytes ? value : undefined;
}

class LanVoiceRequestError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MAX_REQUEST_BYTES) throw new LanVoiceRequestError(413, "LAN voice request is too large");
		chunks.push(buffer);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw new LanVoiceRequestError(400, "LAN voice request must be a JSON object");
	}
}

function requiredClientId(body: Record<string, unknown>): string {
	const clientId = boundedString(body["clientId"], 128);
	if (!clientId) throw new LanVoiceRequestError(400, "A browser client ID is required");
	return clientId;
}

function sendText(response: ServerResponse, contentType: string, body: string, html = false): void {
	response.writeHead(200, {
		"cache-control": "no-store",
		"content-type": contentType,
		"x-content-type-options": "nosniff",
		...(html ? {
			"content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' wss:; media-src 'self' blob:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
			"permissions-policy": "microphone=(self), camera=()",
		} : {}),
	});
	response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}
