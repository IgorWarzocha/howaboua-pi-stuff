import type { IncomingMessage as HttpRequest, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { WebSocket, WebSocketServer } from "ws";
import type { GrokRealtimeConfig } from "../config.ts";
import { appAsset, manifest } from "./app-assets.js";
import { GROK_AUDIO_WORKLET } from "./audio-worklet.js";
import { resolveGrokLanCertificate } from "./certificate.js";
import { RemoteAudio } from "./remote-audio.js";
import { resolveLanVoiceWebTheme } from "./theme.js";
import { GROK_CLIENT, GROK_PAGE } from "./web-ui.js";

export interface LanOptions {
	agentDir: string;
	port: number;
	callbacks: {
		start(audio: RemoteAudio): Promise<void>;
		startDictation(audio: RemoteAudio): Promise<void>;
		finishDictation(): Promise<string>;
		cancelDictation(): Promise<void>;
		theme(): Theme;
		cancelStartup(): void;
		stop(): Promise<void>;
		send(text: string): void;
		state(): {
			status: string;
			muted: boolean;
			piBusy: boolean;
			activity: {
				status: "idle" | "working" | "waiting" | "settled";
				text: string;
				prompt?: string;
			};
			dictation: { status: string; text: string; error?: string };
		};
		mute(muted: boolean): void;
		settings(): {
			config: GrokRealtimeConfig;
			voices: readonly string[];
			models: readonly string[];
			contextModels: readonly string[];
			speeds: readonly number[];
		};
		configure(patch: unknown): GrokRealtimeConfig;
	};
}

export async function startLan(
	options: LanOptions,
): Promise<{ urls: string[]; publish(): void; close(): Promise<void> }> {
	if (
		!Number.isInteger(options.port) ||
		options.port < 1 ||
		options.port > 65535
	)
		throw new Error("Invalid LAN port");
	const certificate = await resolveGrokLanCertificate(options.agentDir);
	const authorities = new Set(
		[...certificate.hostnames, ...certificate.ipAddresses].map((host) =>
			`${host}:${options.port}`.toLowerCase(),
		),
	);
	if (options.port === 443)
		for (const host of [...certificate.hostnames, ...certificate.ipAddresses])
			authorities.add(host.toLowerCase());
	const allowed = (request: HttpRequest): boolean => {
		const host = request.headers.host?.toLowerCase();
		if (!host || !authorities.has(host)) return false;
		if (!request.headers.origin) return true;
		try {
			const origin = new URL(request.headers.origin);
			return (
				origin.protocol === "https:" &&
				origin.host.toLowerCase() === host &&
				origin.origin === request.headers.origin
			);
		} catch {
			return false;
		}
	};
	const audio = new RemoteAudio();
	let mode: "voice" | "dictation" | undefined;
	const sockets = new WebSocketServer({ noServer: true, maxPayload: 0 });
	let closing = false;
	let queue = Promise.resolve();
	const serialize = (work: () => Promise<void>): Promise<void> => {
		const operation = queue.then(work);
		queue = operation.catch(() => {});
		return operation;
	};
	const publish = (): void => {
		const state = options.callbacks.state();
		audio.setMuted(state.muted);
		const message = JSON.stringify({ type: "state", ...state });
		for (const socket of sockets.clients)
			if (socket.readyState === WebSocket.OPEN) socket.send(message);
	};
	const server = createServer(
		{ cert: certificate.cert, key: certificate.key },
		(request, response) => {
			void handle(request, response).catch((error) => {
				if (!response.headersSent)
					response.writeHead(400, { "Content-Type": "application/json" });
				response.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : "Request failed",
					}),
				);
			});
		},
	);
	async function handle(
		request: HttpRequest,
		response: ServerResponse,
	): Promise<void> {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("X-Content-Type-Options", "nosniff");
		if (!allowed(request)) {
			response.writeHead(403);
			response.end("Same-origin access required");
			return;
		}
		if (request.method === "GET") {
			const path = new URL(request.url ?? "/", "https://localhost").pathname;
			const icon = appAsset(path);
			if (icon) {
				response.writeHead(200, { "Content-Type": icon.contentType });
				response.end(icon.body);
				return;
			}
			const assets: Record<string, [string, string]> = {
				"/": ["text/html; charset=utf-8", GROK_PAGE],
				"/client.js": ["text/javascript; charset=utf-8", GROK_CLIENT],
				"/worklet.js": ["text/javascript; charset=utf-8", GROK_AUDIO_WORKLET],
				"/theme": [
					"application/json",
					JSON.stringify(resolveLanVoiceWebTheme(options.callbacks.theme())),
				],
				"/manifest.webmanifest": [
					"application/manifest+json",
					manifest(options.callbacks.theme()),
				],
				"/state": [
					"application/json",
					JSON.stringify(options.callbacks.state()),
				],
				"/settings": [
					"application/json",
					JSON.stringify(options.callbacks.settings()),
				],
			};
			const asset = assets[request.url ?? ""];
			if (!asset) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, { "Content-Type": asset[0] });
			response.end(asset[1]);
			return;
		}
		if (
			request.method !== "POST" ||
			(request.url !== "/control" && request.url !== "/settings")
		) {
			response.writeHead(404);
			response.end();
			return;
		}
		let body = "";
		request.setEncoding("utf8");
		for await (const chunk of request) {
			body += chunk.toString();
		}
		const value: unknown = JSON.parse(body);
		if (request.url === "/settings") {
			let config: GrokRealtimeConfig | undefined;
			await serialize(async () => {
				if (closing) throw new Error("LAN control is closing");
				config = options.callbacks.configure(value);
			});
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ config }));
			return;
		}
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("Invalid control message");
		const command = value as Record<string, unknown>;
		if (
			["stop", "cancelDictation", "finishDictation"].includes(
				String(command["action"]),
			)
		)
			options.callbacks.cancelStartup();
		await serialize(async () => {
			if (closing) throw new Error("LAN control is closing");
			if (command["action"] === "stop") {
				await options.callbacks.stop();
				await audio.close();
				mode = undefined;
			} else if (command["action"] === "finishDictation") {
				const text = await options.callbacks.finishDictation();
				await audio.close();
				mode = undefined;
				publish();
				response.writeHead(200, { "Content-Type": "application/json" });
				response.end(JSON.stringify({ ...options.callbacks.state(), text }));
			} else if (command["action"] === "cancelDictation") {
				await options.callbacks.cancelDictation();
				await audio.close();
				mode = undefined;
			} else if (
				command["action"] === "mute" &&
				typeof command["muted"] === "boolean"
			)
				options.callbacks.mute(command["muted"]);
			else if (
				command["action"] === "send" &&
				typeof command["text"] === "string" &&
				command["text"].trim()
			)
				options.callbacks.send(command["text"].trim());
			else throw new Error("Invalid control message");
			publish();
		});
		if (response.writableEnded) return;
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify(options.callbacks.state()));
	}
	server.on("upgrade", (request, socket, head) => {
		if (
			closing ||
			!["/audio", "/audio?mode=dictation"].includes(request.url ?? "") ||
			!allowed(request)
		) {
			socket.destroy();
			return;
		}
		sockets.handleUpgrade(request, socket, head, (peer) => {
			peer.on("error", () => {});
			void serialize(async () => {
				if (closing || peer.readyState !== WebSocket.OPEN) {
					peer.close();
					return;
				}
				const requestedMode =
					request.url === "/audio?mode=dictation" ? "dictation" : "voice";
				if (mode && mode !== requestedMode) {
					await options.callbacks.stop();
					await audio.close();
					mode = undefined;
				}
				if (!audio.isStarted()) {
					audio.attach(peer);
					try {
						if (requestedMode === "dictation")
							await options.callbacks.startDictation(audio);
						else await options.callbacks.start(audio);
						mode = requestedMode;
					} catch (error) {
						await audio.close();
						throw error;
					}
				} else audio.attach(peer);
				if (closing || peer.readyState !== WebSocket.OPEN) return;
				publish();
			}).catch((error) => {
				if (peer.readyState === WebSocket.OPEN)
					peer.send(
						JSON.stringify({
							type: "error",
							message:
								error instanceof Error
									? error.message
									: "Voice could not start",
						}),
					);
				peer.close(1011, "Voice could not start");
			});
		});
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(options.port, "0.0.0.0", () => {
				server.off("error", reject);
				resolve();
			});
		});
	} catch (error) {
		closing = true;
		for (const peer of sockets.clients) peer.terminate();
		sockets.close();
		await audio.close();
		server.closeAllConnections();
		if (server.listening) server.close();
		throw error;
	}
	let shutdown: Promise<void> | undefined;
	return {
		urls: [...certificate.ipAddresses, ...certificate.hostnames].map(
			(host) => `https://${host}:${options.port}`,
		),
		publish,
		close() {
			shutdown ??= (async () => {
				closing = true;
				options.callbacks.cancelStartup();
				for (const peer of sockets.clients) peer.terminate();
				await queue;
				try {
					if (audio.isStarted()) await options.callbacks.stop();
				} finally {
					await audio.close();
					sockets.close();
					const stopped = new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve())),
					);
					server.closeAllConnections();
					await stopped;
				}
			})();
			return shutdown;
		},
	};
}
