import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type { LanVoiceActivity } from "./activity.ts";
import { getLanVoiceAppAsset } from "./app-assets.ts";
import type { LanVoiceBrowserClients } from "./browser-clients.ts";
import type { LanRemoteCustomApp } from "./custom-app.ts";
import {
	LAN_REMOTE_CLIENT_PATH,
	LAN_REMOTE_DISCOVERY_PATH,
} from "./discovery.ts";
import { type LanVoiceDraft, LanVoiceDraftError } from "./draft.ts";

const MAX_REQUEST_BYTES = 300 * 1024;

interface LanRemoteWebAppState {
	customWebApp: boolean;
	customApp?: LanRemoteCustomApp | undefined;
	discovery: unknown;
}

export interface LanVoiceHttpHandlers {
	activity: LanVoiceActivity;
	clients: LanVoiceBrowserClients;
	draft: LanVoiceDraft;
	renderManifest(): string;
	renderPage(): string;
	clientScript(): string;
	webApp(): LanRemoteWebAppState;
	rpc(body: Record<string, unknown>): Promise<unknown>;
	inputMuted(): boolean;
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
		let webApp: LanRemoteWebAppState | undefined;
		const currentWebApp = () => (webApp ??= handlers.webApp());
		if (request.method === "GET" && path === LAN_REMOTE_CLIENT_PATH) {
			sendText(
				response,
				"text/javascript; charset=utf-8",
				handlers.clientScript(),
			);
			return;
		}
		if (request.method === "GET" && path === LAN_REMOTE_DISCOVERY_PATH) {
			sendJson(response, 200, currentWebApp().discovery);
			return;
		}
		if (request.method === "GET" && path === "/") {
			const app = currentWebApp();
			if (app.customWebApp) {
				const asset = app.customApp?.asset(path);
				if (asset) await sendFile(response, asset, false);
				else sendJson(response, 200, app.discovery);
				return;
			}
			sendText(
				response,
				"text/html; charset=utf-8",
				handlers.renderPage(),
				true,
			);
			return;
		}
		if (
			request.method === "GET" &&
			path === "/manifest.webmanifest" &&
			!currentWebApp().customWebApp
		) {
			sendText(
				response,
				"application/manifest+json; charset=utf-8",
				handlers.renderManifest(),
			);
			return;
		}
		const appAsset =
			request.method === "GET" &&
			!path.startsWith("/api/") &&
			!path.startsWith("/_gippity/") &&
			!currentWebApp().customWebApp
				? getLanVoiceAppAsset(path)
				: undefined;
		if (appAsset) {
			sendBinary(response, appAsset.contentType, appAsset.body);
			return;
		}
		if (
			request.method === "GET" &&
			currentWebApp().customWebApp &&
			!path.startsWith("/api/") &&
			!path.startsWith("/_gippity/")
		) {
			const asset = currentWebApp().customApp?.asset(path);
			if (asset) {
				await sendFile(response, asset, false);
				return;
			}
		}
		if (!handlers.ownerIsActive() || handlers.closing) {
			sendJson(response, 409, {
				error:
					"The Pi session that started this voice server is no longer active",
			});
			return;
		}
		if (request.method === "GET" && path === "/api/events") {
			const clientId = boundedString(url.searchParams.get("client"), 128);
			if (!clientId)
				throw new LanVoiceRequestError(400, "A browser client ID is required");
			response.writeHead(200, {
				"cache-control": "no-store",
				connection: "keep-alive",
				"content-type": "text/event-stream; charset=utf-8",
				"x-accel-buffering": "no",
			});
			response.write("event: ready\ndata: {}\n\n");
			handlers.clients.connectEvents(clientId, response);
			handlers.clients.sendControl(clientId, handlers.draft.snapshot());
			handlers.clients.sendControl(clientId, handlers.activity.snapshot());
			handlers.clients.sendControl(clientId, {
				type: "mute",
				muted: handlers.inputMuted(),
			});
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		assertJsonPost(request);
		const body = await readJson(request);
		if (!handlers.ownerIsActive() || handlers.closing) {
			sendJson(response, 409, {
				error:
					"The Pi session that started this voice server is no longer active",
			});
			return;
		}
		const clientId = requiredClientId(body);
		if (path === "/api/rpc") {
			sendJson(response, 200, await handlers.rpc(body));
			return;
		}
		if (path === "/api/stop") {
			handlers.clients.release(
				clientId,
				undefined,
				body["terminateConversation"] === true,
			);
			sendJson(response, 200, { ok: true });
			return;
		}
		if (path === "/api/draft") {
			const revision = handlers.draft.update(
				clientId,
				body["text"],
				body["revision"],
			);
			sendJson(response, 200, { ok: true, revision });
			return;
		}
		if (path === "/api/send") {
			handlers.draft.send(clientId, body["text"], body["revision"]);
			sendJson(response, 200, { ok: true });
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		const status =
			error instanceof LanVoiceRequestError
				? error.status
				: error instanceof LanVoiceDraftError
					? 400
					: 500;
		if (!response.headersSent)
			sendJson(response, status, {
				error: error instanceof Error ? error.message : String(error),
			});
		else response.end();
	}
}

export function boundedString(
	value: unknown,
	maxBytes: number,
): string | undefined {
	return typeof value === "string" &&
		value.length > 0 &&
		Buffer.byteLength(value) <= maxBytes
		? value
		: undefined;
}

class LanVoiceRequestError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
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
			throw new LanVoiceRequestError(413, "LAN voice request is too large");
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
		throw new LanVoiceRequestError(
			400,
			"LAN voice request must be a JSON object",
		);
	}
}

function requiredClientId(body: Record<string, unknown>): string {
	const clientId = boundedString(body["clientId"], 128);
	if (!clientId)
		throw new LanVoiceRequestError(400, "A browser client ID is required");
	return clientId;
}

function sendText(
	response: ServerResponse,
	contentType: string,
	body: string,
	html = false,
): void {
	response.writeHead(200, {
		"cache-control": "no-store",
		"content-type": contentType,
		"x-content-type-options": "nosniff",
		...(html
			? {
					"content-security-policy":
						"default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'self' wss:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
					"permissions-policy": "microphone=(self), camera=()",
				}
			: {}),
	});
	response.end(body);
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

function sendBinary(
	response: ServerResponse,
	contentType: string,
	body: Buffer,
	cache = true,
): void {
	response.writeHead(200, {
		"cache-control": cache ? "public, max-age=86400" : "no-store",
		"content-length": body.byteLength,
		"content-type": contentType,
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}

async function sendFile(
	response: ServerResponse,
	asset: { contentType: string; path: string },
	cache: boolean,
): Promise<void> {
	response.writeHead(200, {
		"cache-control": cache ? "public, max-age=86400" : "no-store",
		"content-type": asset.contentType,
		"x-content-type-options": "nosniff",
	});
	await pipeline(createReadStream(asset.path), response);
}

function assertJsonPost(request: IncomingMessage): void {
	const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
	if (contentType !== "application/json")
		throw new LanVoiceRequestError(
			415,
			"GipPity requests must use application/json",
		);
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (origin && (!host || origin !== `https://${host}`))
		throw new LanVoiceRequestError(
			403,
			"Cross-origin GipPity requests are not allowed",
		);
}
