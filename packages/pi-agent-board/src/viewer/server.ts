import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";
import { Archive } from "./archive.ts";
import { accessKey, loadConfig, type ViewerConfig } from "./config.ts";
import type { ViewSource } from "./contracts.ts";
import { parseSource } from "./source.ts";

export const PROTOCOL = "pi-board-viewer/1";
const assets = new Map<string, readonly [string, string]>([
	["/", ["web/index.html", "text/html; charset=utf-8"]],
	["/app.js", ["web/app.js", "text/javascript; charset=utf-8"]],
	["/style.css", ["web/style.css", "text/css; charset=utf-8"]],
	[
		"/vendor/marked.js",
		[import.meta.resolve("marked"), "text/javascript; charset=utf-8"],
	],
	[
		"/vendor/purify.js",
		[import.meta.resolve("dompurify"), "text/javascript; charset=utf-8"],
	],
] as const);

function authenticated(req: IncomingMessage, secret: string): boolean {
	const value = req.headers.authorization;
	if (!value?.startsWith("Bearer ")) return false;
	const provided = Buffer.from(value.slice(7));
	const expected = Buffer.from(secret);
	return (
		provided.length === expected.length && timingSafeEqual(provided, expected)
	);
}

async function body(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of req) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		length += bytes.length;
		if (length > 16_384) throw new Error("Viewer request is too large");
		chunks.push(bytes);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(value));
}

export async function startServer(config: ViewerConfig, key: string) {
	const views = new Map<string, ViewSource>();
	const registered = new Map<string, string>();
	const server = createServer((req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
		);
		void handle(req, res).catch((error: unknown) => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			json(res, 400, {
				error: error instanceof Error ? error.message : "Viewer request failed",
			});
		});
	});
	server.headersTimeout = 10_000;
	server.requestTimeout = 10_000;
	server.maxHeadersCount = 50;

	async function handle(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.method === "GET" && url.pathname === "/api/health") {
			json(res, 200, {
				protocol: PROTOCOL,
				host: config.host,
				publicUrl: config.publicUrl,
				pid: process.pid,
			});
			return;
		}
		if (req.method === "POST" && url.pathname === "/api/open") {
			// Only the local extension may register filesystem sources. View links cannot.
			if (
				req.socket.remoteAddress !== "127.0.0.1" ||
				!authenticated(req, key)
			) {
				json(res, 403, {
					error: "Only the local Pi extension can open a board archive",
				});
				return;
			}
			const source = parseSource(await body(req));
			const archive = new Archive(source);
			try {
				archive.index();
			} finally {
				archive.close();
			}
			const identity = JSON.stringify(source);
			const token = registered.get(identity) ?? randomBytes(32).toString("hex");
			registered.set(identity, token);
			views.set(token, source);
			json(res, 200, { url: `${config.publicUrl}/#view=${token}` });
			return;
		}
		if (req.method !== "GET") {
			json(res, 405, { error: "The board viewer is read-only" });
			return;
		}
		if (url.pathname.startsWith("/api/")) {
			const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
			const source = views.get(token);
			if (!source) {
				json(res, 401, {
					error:
						"This viewer link has expired. Run /board in Pi for a new link.",
				});
				return;
			}
			const archive = new Archive(source);
			try {
				const board = url.searchParams.get("boardId") ?? source.boardId;
				let result: unknown;
				switch (url.pathname) {
					case "/api/boards":
						result = archive.index();
						break;
					case "/api/board":
						result = archive.detail(board);
						break;
					case "/api/threads":
						result = archive.threads(board, url.searchParams);
						break;
					case "/api/thread":
						result = archive.thread(
							board,
							url.searchParams.get("id") ?? "",
							url.searchParams,
						);
						break;
					default:
						json(res, 404, { error: "Unknown viewer request" });
						return;
				}
				json(res, 200, result);
			} finally {
				archive.close();
			}
			return;
		}
		const asset = assets.get(url.pathname);
		if (!asset) {
			json(res, 404, { error: "Page not found" });
			return;
		}
		const content = await readFile(new URL(asset[0], import.meta.url));
		res.writeHead(200, { "Content-Type": asset[1] });
		res.end(content);
	}
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	return server;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const config = await loadConfig();
	const server = await startServer(config, await accessKey());
	console.log(
		`Board viewer listening on ${config.host}:${config.port} (PID ${process.pid})`,
	);
	const stop = () => {
		server.close();
		server.closeAllConnections();
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
}
