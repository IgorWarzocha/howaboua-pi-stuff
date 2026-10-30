import type { IncomingMessage, ServerResponse } from "node:http";
import type { LanVoiceActivity } from "./activity.ts";
import { getLanVoiceAppAsset } from "./app-assets.ts";
import type { LanVoiceBrowserClients } from "./browser-clients.ts";
import type { LanRemoteCustomApp } from "./custom-app.ts";
import {
	LAN_REMOTE_CLIENT_PATH,
	LAN_REMOTE_DISCOVERY_PATH,
} from "./discovery.ts";
import { type LanVoiceDraft, LanVoiceDraftError } from "./draft.ts";
import {
	assertJsonPost,
	boundedString,
	isLanVoiceOriginAllowed,
	LanVoiceRequestError,
	readJson,
	requiredClientId,
	sendBinary,
	sendFile,
	sendJson,
	sendText,
} from "./http-protocol.ts";
import type {
	GippityRemoteAppMessage,
	GippityRemoteAppRoute,
} from "./remote-app.ts";
import { LanVoiceSettingsError } from "./settings.ts";

interface LanRemoteWebAppState {
	customWebApp: boolean;
	customApp?: LanRemoteCustomApp | undefined;
	discovery: unknown;
}

export interface LanVoiceHttpHandlers {
	takeoverToken?: string | undefined;
	settings(): unknown;
	configureSettings(body: Record<string, unknown>): unknown;
	activity: LanVoiceActivity;
	clients: LanVoiceBrowserClients;
	draft: LanVoiceDraft;
	renderManifest(): string;
	renderPage(): string;
	clientScript(): string;
	webApp(): LanRemoteWebAppState;
	rpc(body: Record<string, unknown>): Promise<unknown>;
	inputMuted(): boolean;
	sessionSnapshot(): unknown;
	remoteAppSnapshot(): GippityRemoteAppMessage | undefined;
	remoteAppRoute(path: string): GippityRemoteAppRoute;
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
		if (request.method === "GET" && path.startsWith("/_gippity/apps/")) {
			const app = handlers.remoteAppRoute(path);
			if (app.kind === "none" || app.kind === "missing") {
				sendJson(response, 404, { error: "Not found" });
				return;
			}
			if (app.kind === "redirect") {
				response.writeHead(308, { location: app.location });
				response.end();
				return;
			}
			await sendFile(response, app.asset, false);
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
		if (request.method === "GET" && path === "/api/settings") {
			if (!isLanVoiceOriginAllowed(request))
				throw new LanVoiceRequestError(
					403,
					"Same-origin settings access required",
				);
			sendJson(response, 200, handlers.settings());
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
			if (handlers.takeoverToken)
				handlers.clients.sendControl(clientId, {
					type: "ready",
					takeoverToken: handlers.takeoverToken,
				});
			handlers.clients.sendControl(clientId, handlers.draft.snapshot());
			handlers.clients.sendControl(clientId, handlers.activity.snapshot());
			const session = handlers.sessionSnapshot();
			if (session) handlers.clients.sendControl(clientId, session);
			handlers.clients.sendControl(clientId, {
				type: "mute",
				muted: handlers.inputMuted(),
			});
			const remoteApp = handlers.remoteAppSnapshot();
			if (remoteApp) handlers.clients.sendControl(clientId, remoteApp);
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
		if (path === "/api/settings") {
			try {
				sendJson(response, 200, handlers.configureSettings(body));
			} catch (error) {
				if (error instanceof LanVoiceSettingsError)
					throw new LanVoiceRequestError(400, error.message);
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
			await handlers.draft.send(clientId, body["text"], body["revision"]);
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
