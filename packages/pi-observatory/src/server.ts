import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import {
	accessKey,
	loadConfig,
	PROTOCOL,
	sourceId,
	stateDirectory,
} from "./config.ts";
import { initialiseDatabase, openDatabase } from "./database.ts";

async function acquireLock(path: string): Promise<() => Promise<void>> {
	try {
		const file = await open(path, "wx", 0o600);
		try {
			await file.writeFile(String(process.pid));
		} finally {
			await file.close();
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw error;
		const pid = Number(await readFile(path, "utf8"));
		if (!Number.isSafeInteger(pid) || pid <= 0)
			throw new Error(`Invalid index lock. Check ${path} before removing it.`);
		try {
			process.kill(pid, 0);
		} catch (probe) {
			if (probe instanceof Error && "code" in probe && probe.code === "ESRCH") {
				await unlink(path);
				return acquireLock(path);
			}
			throw probe;
		}
		throw new Error(
			`Observatory is already in use by process ${pid}. Open its dashboard or stop that process before restarting.`,
		);
	}
	return () => unlink(path);
}

function loopbackHost(host: string): boolean {
	return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

function authenticated(header: string | undefined, key: string): boolean {
	const supplied = Buffer.from(header ?? "");
	const expected = Buffer.from(`Bearer ${key}`);
	return (
		supplied.length === expected.length && timingSafeEqual(supplied, expected)
	);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			sessions: { type: "string" },
			db: { type: "string" },
			port: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(
			"Pi Observatory\n\nnode src/server.ts [--sessions DIR] [--db FILE] [--port 47985]\n\nOr run /observatory in Pi to start and open the dashboard.\nRead-only background session indexing. The dashboard reads SQLite only.\nCtrl+C stops this standalone server; restart resumes saved cursors.\nDefaults to 127.0.0.1. Remote access is configured in observatory/config.json.",
		);
		return;
	}
	const config = await loadConfig(values);
	const { port, sessions, database } = config;
	let publicUrl = config.publicUrl;
	const identity = sourceId(config);
	process.umask(0o077);
	const masterKey = await accessKey();
	await mkdir(dirname(database), { recursive: true, mode: 0o700 });
	const releaseServer = await acquireLock(
		join(stateDirectory(), "server.lock"),
	);
	let releaseDatabase: (() => Promise<void>) | undefined;
	const workers: Worker[] = [];
	const pending = new Map<
		number,
		{ response: ServerResponse; timer: NodeJS.Timeout }
	>();
	let sequence = 0;
	const token = randomBytes(32).toString("hex");
	const server = createServer();
	try {
		releaseDatabase = await acquireLock(`${database}.lock`);
		const db = openDatabase(database);
		try {
			initialiseDatabase(db, sessions);
		} finally {
			db.close();
		}
		const assets = new Map<string, { data: Buffer; type: string }>();
		for (const [path, file, type] of [
			["/", "index.html", "text/html; charset=utf-8"],
			["/app.js", "app.js", "text/javascript; charset=utf-8"],
			["/style.css", "style.css", "text/css; charset=utf-8"],
		] as const)
			assets.set(path, {
				data: await readFile(new URL(`../web/${file}`, import.meta.url)),
				type,
			});
		const reader = new Worker(new URL("./query-worker.ts", import.meta.url), {
			workerData: database,
		});
		const writer = new Worker(new URL("./index-worker.ts", import.meta.url), {
			workerData: { database, sessions },
		});
		workers.push(reader, writer);
		reader.on(
			"message",
			(message: { id: number; status: number; value: unknown }) => {
				const request = pending.get(message.id);
				if (!request) return;
				clearTimeout(request.timer);
				pending.delete(message.id);
				request.response
					.writeHead(message.status, {
						"Content-Type": "application/json; charset=utf-8",
					})
					.end(JSON.stringify(message.value));
			},
		);
		server.on("request", (request, response) => {
			response.setHeader("Cache-Control", "no-store");
			response.setHeader("X-Content-Type-Options", "nosniff");
			response.setHeader("Referrer-Policy", "no-referrer");
			response.setHeader(
				"Content-Security-Policy",
				"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
			);
			const host = request.headers.host ?? "";
			if (!loopbackHost(host) && host !== new URL(publicUrl).host) {
				response.writeHead(403).end("Unrecognised viewer host");
				return;
			}
			if (
				request.headers.origin &&
				request.headers.origin !== `http://${host}` &&
				request.headers.origin !== publicUrl
			) {
				response.writeHead(403).end("Cross-origin requests are not accepted");
				return;
			}
			if ((request.url?.length ?? 0) > 8192) {
				response.writeHead(414).end();
				return;
			}
			let url: URL;
			try {
				url = new URL(request.url ?? "/", `http://${host}`);
			} catch {
				response.writeHead(400).end("Invalid request URL");
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/health") {
				response.writeHead(200, { "Content-Type": "application/json" }).end(
					JSON.stringify({
						protocol: PROTOCOL,
						host: config.host,
						publicUrl,
						sourceId: identity,
						pid: process.pid,
					}),
				);
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/open") {
				if (
					request.socket.remoteAddress !== "127.0.0.1" ||
					!authenticated(request.headers.authorization, masterKey)
				) {
					response.writeHead(403, { "Content-Type": "application/json" }).end(
						JSON.stringify({
							error: "Only the local Pi extension can open a viewer link",
						}),
					);
					return;
				}
				request.resume();
				const session = url.searchParams.get("session") ?? "";
				if (session.length > 256) {
					response
						.writeHead(400, { "Content-Type": "application/json" })
						.end(JSON.stringify({ error: "Invalid session ID" }));
					return;
				}
				const selection = session
					? `?session=${encodeURIComponent(session)}`
					: "";
				response
					.writeHead(200, { "Content-Type": "application/json" })
					.end(
						JSON.stringify({ url: `${publicUrl}/${selection}#token=${token}` }),
					);
				return;
			}
			if (request.method !== "GET") {
				response.writeHead(405, { Allow: "GET" }).end();
				return;
			}
			const asset = assets.get(url.pathname);
			if (asset) {
				response.writeHead(200, { "Content-Type": asset.type }).end(asset.data);
				return;
			}
			if (!authenticated(request.headers.authorization, token)) {
				response.writeHead(401).end();
				return;
			}
			if (
				!/^\/api\/(?:status|sessions|facets|overview|calls(?:\/\d+)?)$/.test(
					url.pathname,
				)
			) {
				response.writeHead(404).end();
				return;
			}
			if (pending.size >= 32) {
				response.writeHead(503).end("Query queue is full. Retry shortly.");
				return;
			}
			const id = ++sequence;
			const timer = setTimeout(() => {
				pending.delete(id);
				response
					.writeHead(504)
					.end("Query timed out. Narrow the filters and retry.");
			}, 10000);
			pending.set(id, { response, timer });
			response.on("close", () => {
				clearTimeout(timer);
				pending.delete(id);
			});
			reader.postMessage({ id, path: url.pathname, search: url.search });
		});
		await new Promise<void>((done, fail) => {
			for (const worker of workers) {
				worker.once("error", fail);
				worker.once("exit", (code) =>
					fail(
						new Error(
							`Dashboard worker stopped (${code}). Restart to resume indexing.`,
						),
					),
				);
			}
			server.once("error", fail);
			process.once("SIGINT", done);
			process.once("SIGTERM", done);
			server.listen(port, config.host, () => {
				const address = server.address();
				if (!address || typeof address === "string") {
					fail(new Error("Could not determine dashboard address"));
					return;
				}
				if (publicUrl === "http://127.0.0.1:0")
					publicUrl = `http://127.0.0.1:${address.port}`;
				console.log(
					`Pi Observatory: ${publicUrl}/#token=${token}\nSessions: ${sessions}\nIndex: ${database}\nBackground indexing active. Ctrl+C to stop.`,
				);
			});
		});
	} finally {
		server.close();
		server.closeAllConnections();
		for (const { response, timer } of pending.values()) {
			clearTimeout(timer);
			response.destroy();
		}
		await Promise.all(
			workers.map(async (worker) => {
				worker.postMessage("stop");
				const timer = setTimeout(() => {
					void worker.terminate();
				}, 2000);
				await new Promise<void>((done) => {
					if (worker.threadId === -1) done();
					else worker.once("exit", () => done());
				});
				clearTimeout(timer);
			}),
		);
		try {
			await releaseDatabase?.();
		} finally {
			await releaseServer();
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
