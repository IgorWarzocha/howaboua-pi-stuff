import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GIPPITY_CONTROL_CONFIG } from "../src/config.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";

describe("LAN origin boundary", () => {
	test("rejects foreign origins on HTTP control and audio upgrades", async () => {
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
		} finally {
			await server.close();
			await rm(root, { recursive: true, force: true });
		}
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
