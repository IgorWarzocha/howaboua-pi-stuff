import { boundedString, isLanVoiceOriginAllowed, LanVoiceRequestError, readJson, requiredClientId, sendText, sendJson, sendBinary, assertJsonPost } from "./http-protocol.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LanVoiceSettingsError } from "./settings-contract.ts";
import type { LanVoiceBrowserClients } from "./browser-clients.ts";
import type { LanVoiceActivity } from "./activity.ts";
import { getLanVoiceAppAsset } from "./app-assets.ts";
import { LanVoiceDraftError, type LanVoiceDraft } from "./draft.ts";


export interface LanVoiceHttpHandlers {
	settings(): unknown;
	configureSettings(body: Record<string, unknown>): unknown;
	activity: LanVoiceActivity;
	clients: LanVoiceBrowserClients;
	draft: LanVoiceDraft;
	renderManifest(): string;
	renderPage(): string;
	inputMuted(): boolean;
	sessionSnapshot(): unknown;
	rpc(body: Record<string, unknown>): Promise<unknown>;
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
			sendText(response, "text/html; charset=utf-8", handlers.renderPage(), true);
			return;
		}
		if (request.method === "GET" && path === "/manifest.webmanifest") {
			sendText(response, "application/manifest+json; charset=utf-8", handlers.renderManifest());
			return;
		}
		const appAsset = request.method === "GET" ? getLanVoiceAppAsset(path) : undefined;
		if (appAsset) {
			sendBinary(response, appAsset.contentType, appAsset.body);
			return;
		}
		if (!handlers.ownerIsActive() || handlers.closing) {
			sendJson(response, 409, { error: "The Pi session that started this voice server is no longer active" });
			return;
		}
		if (request.method === "GET" && path === "/api/settings") {
			if (!isLanVoiceOriginAllowed(request)) throw new LanVoiceRequestError(403, "Same-origin settings access required");
			sendJson(response, 200, handlers.settings());
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
			handlers.clients.sendControl(clientId, handlers.draft.snapshot());
			handlers.clients.sendControl(clientId, handlers.activity.snapshot());
			const session = handlers.sessionSnapshot();
			if (session) handlers.clients.sendControl(clientId, session);
			handlers.clients.sendControl(clientId, { type: "mute", muted: handlers.inputMuted() });
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		assertJsonPost(request);
		const body = await readJson(request);
		if (!handlers.ownerIsActive() || handlers.closing) {
			sendJson(response, 409, { error: "The Pi session that started this voice server is no longer active" });
			return;
		}
		if (path === "/api/settings") {
			try {
				sendJson(response, 200, handlers.configureSettings(body));
			} catch (error) {
				if (error instanceof LanVoiceSettingsError) throw new LanVoiceRequestError(400, error.message);
				throw error;
			}
			return;
		}
		const clientId = requiredClientId(body);
		if (path === "/api/rpc") {
			sendJson(response, 200, await handlers.rpc(body));
			return;
		}
		if (path === "/api/stop") {
			handlers.clients.release(clientId, undefined, body["terminateConversation"] === true);
			sendJson(response, 200, { ok: true });
			return;
		}
		if (path === "/api/draft") {
			const revision = handlers.draft.update(clientId, body["text"], body["revision"]);
			sendJson(response, 200, { ok: true, revision });
			return;
		}
		if (path === "/api/send") {
			await handlers.draft.send(clientId, body["text"], body["revision"]);
			sendJson(response, 200, { ok: true });
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		const status = error instanceof LanVoiceRequestError ? error.status : error instanceof LanVoiceDraftError ? 400 : 500;
		if (!response.headersSent) sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
		else response.end();
	}
}

export { boundedString, isLanVoiceOriginAllowed };
