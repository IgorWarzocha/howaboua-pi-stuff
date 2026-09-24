import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { DEFAULT_GIPPITY_CONTROL_CONFIG } from "../src/config.ts";
import { LanVoiceBrowserClients } from "../src/voice/lan/browser-clients.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";

describe("LAN conversation setup", () => {
	test("admits its own pages and trusted clients, not unrelated websites", async () => {
		const root = await mkdtemp(join(tmpdir(), "gippity-lan-access-"));
		const html = "<!doctype html><p>Phone controls</p>";
		await writeFile(join(root, "index.html"), html);
		const server = await startCodexLanVoiceServer({
			ctx: {
				cwd: root,
				isIdle: () => true,
				sessionManager: { getSessionId: () => "owner" },
			} as never,
			pi: {} as never,
			getConfig: () => ({
				...DEFAULT_GIPPITY_CONTROL_CONFIG,
				lan: { customWebApp: true, customWebAppPath: root },
			}),
			voice: { onInputMuteChange: () => () => {} } as never,
			resolveAuth: async () => {
				throw new Error("Voice auth must stay unused");
			},
			sendUserMessage: () => {
				throw new Error("No user turn expected");
			},
			ownerSessionId: "owner",
			port: 0,
			certificateAgentDir: root,
			remoteApps: {
				apps: () => [],
				onMessage: () => () => {},
				route: () => ({
					kind: "asset",
					asset: {
						path: join(root, "index.html"),
						contentType: "text/html; charset=utf-8",
					},
				}),
			} as never,
		});
		try {
			const url = new URL(server.urls[0]!);
			url.hostname = "127.0.0.1";
			for (const { headers, status } of [
				{ headers: { origin: url.origin }, status: 200 },
				{
					headers: {
						host: "phone.local:4443",
						origin: "https://phone.local:4443",
					},
					status: 200,
				},
				{ headers: {}, status: 200 },
				{ headers: { origin: "https://unrelated.example" }, status: 403 },
				{ headers: { origin: "null" }, status: 403 },
				{ headers: { origin: `http://${url.host}` }, status: 403 },
				{ headers: { origin: `https://${url.hostname}:1` }, status: 403 },
			] satisfies { headers: Record<string, string>; status: number }[]) {
				const post = await requestText(
					new URL("/api/stop", url),
					'{"clientId":"phone"}',
					headers,
				);
				const audio = await requestText(
					new URL("/api/audio?client=phone", url),
					undefined,
					{
						...headers,
						connection: "Upgrade",
						upgrade: "websocket",
						"sec-websocket-version": "13",
						"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
					},
				);
				expect({ post: post.status, audio: audio.status }).toEqual({
					post: status,
					audio: status === 200 ? 101 : status,
				});
			}
			for (const path of ["/", "/_gippity/apps/controls/index.html"]) {
				const page = await requestText(new URL(path, url));
				expect(page.status).toBe(200);
				expect(page.body).toBe(html);
				expect(page.headers["content-security-policy"]).toBe(
					"frame-ancestors 'self'",
				);
			}
		} finally {
			await server.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("preserves device handoff and restarts after explicit release", async () => {
		let hostStarts = 0;
		let hostConversation: object | undefined;
		const clients = testBrowserClients({
			async ensureConversation() {
				if (!hostConversation) {
					hostConversation = {};
					hostStarts += 1;
				}
			},
			onConversationActivity(active) {
				if (!active) hostConversation = undefined;
			},
		});
		const first = new TestWebSocket();
		clients.connectAudio("first", first.asWebSocket());
		first.receive({ type: "start", mode: "conversation" });
		await settle();
		first.close();
		await settle();
		const second = new TestWebSocket();
		clients.connectAudio("second", second.asWebSocket());
		second.receive({ type: "start", mode: "conversation" });
		await settle();
		expect(hostStarts).toBe(1);
		expect(
			second.sent.map((value) => JSON.parse(String(value))).at(-1),
		).toEqual({
			type: "active",
			mode: "conversation",
			muted: false,
			speakerSuppressed: false,
		});
		second.receive({ type: "release" });
		await settle();
		second.receive({ type: "start", mode: "conversation" });
		await settle();
		expect(hostStarts).toBe(2);
		await clients.close();
	});

	test("takeover shares the pending host conversation setup", async () => {
		const setup = Promise.withResolvers<void>();
		let hostStarts = 0;
		let sharedSetup: Promise<void> | undefined;
		const clients = testBrowserClients({
			ensureConversation() {
				if (!sharedSetup) {
					hostStarts += 1;
					sharedSetup = setup.promise;
				}
				return sharedSetup;
			},
		});
		const first = new TestWebSocket();
		clients.connectAudio("first", first.asWebSocket());
		first.receive({ type: "start", mode: "conversation" });
		await settle();
		const second = new TestWebSocket();
		clients.connectAudio("second", second.asWebSocket());
		second.receive({ type: "start", mode: "conversation" });
		setup.resolve();
		await settle();
		await settle();
		expect(hostStarts).toBe(1);
		expect(first.readyState).toBe(WebSocket.CLOSED);
		expect(
			second.sent.map((value) => JSON.parse(String(value))).at(-1),
		).toEqual({
			type: "active",
			mode: "conversation",
			muted: false,
			speakerSuppressed: false,
		});
		await clients.close();
	});

	test("reports startup errors without a terminal stop racing them", async () => {
		const clients = testBrowserClients({
			async ensureConversation() {
				throw new Error("authentication failed");
			},
		});
		const socket = new TestWebSocket();
		clients.connectAudio("first", socket.asWebSocket());
		socket.receive({ type: "start", mode: "conversation" });
		await settle();
		expect(socket.sent.map((value) => JSON.parse(String(value)))).toEqual([
			{ type: "connected" },
			{ type: "error", message: "authentication failed" },
		]);
		await clients.close();
	});
});

function requestText(
	url: URL,
	body?: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			url,
			{
				method: body === undefined ? "GET" : "POST",
				rejectUnauthorized: false,
				headers: {
					...(body === undefined
						? {}
						: { "content-length": Buffer.byteLength(body) }),
					"content-type": "application/json",
					...headers,
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
						headers: response.headers,
					}),
				);
			},
		);
		request.once("upgrade", (response, socket) => {
			socket.destroy();
			resolve({
				status: response.statusCode ?? 0,
				body: "",
				headers: response.headers,
			});
		});
		request.setTimeout(3_000, () =>
			request.destroy(new Error("LAN request timed out")),
		);
		request.on("error", reject);
		request.end(body);
	});
}

function testBrowserClients(overrides: {
	ensureConversation(): Promise<void>;
	onConversationActivity?(active: boolean): void | Promise<void>;
}): LanVoiceBrowserClients {
	return new LanVoiceBrowserClients({
		...overrides,
		startDictation: async () => {},
		finishDictation: async () => {},
		cancelDictation: async () => {},
		onConversationActivity: overrides.onConversationActivity ?? (() => {}),
		onConversationMute: () => {},
		conversationMuted: () => false,
		onConversationInputTooQuiet: () => {},
		onConversationAudio: () => {},
		onDictationAudio: () => {},
	});
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

class TestWebSocket extends EventEmitter {
	readyState: number = WebSocket.OPEN;
	bufferedAmount = 0;
	readonly sent: Array<string | Buffer> = [];

	asWebSocket(): WebSocket {
		return this as unknown as WebSocket;
	}

	send(value: string | Buffer): void {
		this.sent.push(value);
	}

	receive(value: unknown): void {
		this.emit("message", Buffer.from(JSON.stringify(value)), false);
	}

	close(code = 1000, reason = "closed"): void {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.emit("close", code, Buffer.from(reason));
	}

	terminate(): void {
		this.close(1006, "terminated");
	}
}
