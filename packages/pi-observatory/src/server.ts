#!/usr/bin/env node
import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { loadConfig, PROTOCOL, sourceId, stateDirectory } from "./config.ts";
import { serveCustomTabQuery, serveCustomTabs } from "./custom-tab-http.ts";
import { type CustomTabs, createCustomTabs } from "./custom-tabs/index.ts";
import { initialiseDatabase, openDatabase } from "./database.ts";
import { createMonitor } from "./monitor.ts";
import { readThemeCss } from "./theme.ts";

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

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			sessions: { type: "string" },
			db: { type: "string" },
			port: { type: "string" },
			"defer-initial-update": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(
			"Pi Observatory\n\npi-observatory [--sessions DIR] [--db FILE] [--port 47985]\n\nOr run /observatory in Pi to start and open the dashboard.\nRead-only background session indexing. The dashboard reads SQLite only.\nCtrl+C stops this standalone server; restart resumes saved cursors.\nDefaults to 127.0.0.1. Remote access is configured in observatory/config.json.",
		);
		return;
	}
	const config = await loadConfig(values);
	const { port, sessions, database } = config;
	let publicUrl = config.publicUrl;
	const identity = sourceId(config);
	process.umask(0o077);
	await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
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
	const server = createServer();
	let tabs: CustomTabs | undefined;
	let monitor: ReturnType<typeof createMonitor> | undefined;
	try {
		await rm(join(stateDirectory(), "access-key"), { force: true });
		releaseDatabase = await acquireLock(`${database}.lock`);
		const db = openDatabase(database);
		try {
			initialiseDatabase(db, sessions);
		} finally {
			db.close();
		}
		const customTabs = await createCustomTabs(config.tabs, {
			stateRoot: join(stateDirectory(), "tabs"),
			sessions,
		});
		tabs = customTabs;
		const assets = new Map<string, { data: Buffer; type: string }>();
		for (const [path, file, type] of [
			["/", "index.html", "text/html; charset=utf-8"],
			["/app.js", "app.js", "text/javascript; charset=utf-8"],
			["/monitor-view.js", "monitor-view.js", "text/javascript; charset=utf-8"],
			["/api.js", "api.js", "text/javascript; charset=utf-8"],
			[
				"/custom-tabs-view.js",
				"custom-tabs-view.js",
				"text/javascript; charset=utf-8",
			],
			["/tab-client.js", "tab-client.js", "text/javascript; charset=utf-8"],
			["/calls-view.js", "calls-view.js", "text/javascript; charset=utf-8"],
			["/filters-view.js", "filters-view.js", "text/javascript; charset=utf-8"],
			["/navigation.js", "navigation.js", "text/javascript; charset=utf-8"],
			[
				"/overview-view.js",
				"overview-view.js",
				"text/javascript; charset=utf-8",
			],
			["/view-dom.js", "view-dom.js", "text/javascript; charset=utf-8"],
			["/charts.js", "charts.js", "text/javascript; charset=utf-8"],
			[
				"/activity-chart.js",
				"activity-chart.js",
				"text/javascript; charset=utf-8",
			],
			["/usage-view.js", "usage-view.js", "text/javascript; charset=utf-8"],
			[
				"/skill-selection.js",
				"skill-selection.js",
				"text/javascript; charset=utf-8",
			],
			[
				"/usage-timeline.js",
				"usage-timeline.js",
				"text/javascript; charset=utf-8",
			],
			[
				"/timeline-chart.js",
				"timeline-chart.js",
				"text/javascript; charset=utf-8",
			],
			["/style.css", "style.css", "text/css; charset=utf-8"],
			["/base.css", "base.css", "text/css; charset=utf-8"],
			["/table.css", "table.css", "text/css; charset=utf-8"],
			["/header.css", "header.css", "text/css; charset=utf-8"],
			["/overview.css", "overview.css", "text/css; charset=utf-8"],
			["/activity.css", "activity.css", "text/css; charset=utf-8"],
			["/usage.css", "usage.css", "text/css; charset=utf-8"],
			["/calls.css", "calls.css", "text/css; charset=utf-8"],
			["/custom-tabs.css", "custom-tabs.css", "text/css; charset=utf-8"],
		] as const)
			assets.set(path, {
				data: await readFile(new URL(`../web/${file}`, import.meta.url)),
				type,
			});
		const reader = new Worker(new URL("./query-worker.js", import.meta.url), {
			workerData: database,
		});
		const writer = new Worker(new URL("./index-worker.js", import.meta.url), {
			workerData: {
				database,
				sessions,
				observationsRoot: join(stateDirectory(), "events"),
			},
		});
		workers.push(reader, writer);
		const collection = createMonitor(writer, customTabs);
		monitor = collection;
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
				collection.updateOnce();
				response
					.writeHead(200, { "Content-Type": "application/json" })
					.end(JSON.stringify({ url: `${publicUrl}/${selection}` }));
				return;
			}
			if (collection.serve(request, url, response)) return;
			if (serveCustomTabQuery(request, url, response, customTabs)) return;
			if (request.method !== "GET") {
				response.writeHead(405, { Allow: "GET" }).end();
				return;
			}
			if (url.pathname === "/theme.css") {
				void readThemeCss().then(
					(css) =>
						response
							.writeHead(200, { "Content-Type": "text/css; charset=utf-8" })
							.end(css),
					(error: unknown) => {
						console.error("Could not read Observatory theme:", error);
						response
							.writeHead(500)
							.end("Could not load the Pi theme. Run /observatory again.");
					},
				);
				return;
			}
			const asset = assets.get(url.pathname);
			if (asset) {
				response.writeHead(200, { "Content-Type": asset.type }).end(asset.data);
				return;
			}
			if (serveCustomTabs(url, response, customTabs)) return;
			if (
				!/^\/api\/(?:status|sessions|facets|overview|usage|calls(?:\/\d+)?)$/.test(
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
				if (!values["defer-initial-update"]) collection.updateOnce();
				console.log(
					`Pi Observatory: ${publicUrl}/\nSessions: ${sessions}\nIndex: ${database}\n${values["defer-initial-update"] ? "Waiting for the viewer to open." : "Updating once, then pausing."} Use the dashboard to enable live monitoring. Ctrl+C to stop.`,
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
		await monitor?.close();
		await tabs?.close();
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
