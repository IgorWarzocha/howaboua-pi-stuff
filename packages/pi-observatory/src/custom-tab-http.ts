import type { IncomingMessage, ServerResponse } from "node:http";
import type { CustomTabs } from "./custom-tabs/index.ts";
import { TabQueryError } from "./custom-tabs/query.ts";

const MAX_QUERY_BODY_BYTES = 16 * 1024;

function readQueryInput(request: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const cleanup = () => {
			request.off("data", data);
			request.off("end", end);
			request.off("error", fail);
			request.off("aborted", aborted);
		};
		const fail = (error: Error) => {
			cleanup();
			reject(error);
		};
		const aborted = () =>
			fail(new TabQueryError(499, "Tab query was cancelled."));
		const data = (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_QUERY_BODY_BYTES) {
				fail(
					new TabQueryError(
						413,
						"Tab query body exceeds 16 KiB. Send a smaller request.",
					),
				);
				request.resume();
			} else chunks.push(chunk);
		};
		const end = () => {
			cleanup();
			try {
				const json = new TextDecoder("utf-8", { fatal: true }).decode(
					Buffer.concat(chunks),
				);
				resolve(JSON.parse(json));
			} catch {
				reject(
					new TabQueryError(
						400,
						"Tab query body must contain exactly one JSON value.",
					),
				);
			}
		};
		request.on("data", data);
		request.once("end", end);
		request.once("error", fail);
		request.once("aborted", aborted);
	});
}

async function queryTab(
	request: IncomingMessage,
	response: ServerResponse,
	tabs: CustomTabs,
	id: string,
): Promise<void> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	request.once("aborted", abort);
	response.once("close", abort);
	try {
		const length = Number(request.headers["content-length"]);
		if (length > MAX_QUERY_BODY_BYTES) {
			request.resume();
			throw new TabQueryError(
				413,
				"Tab query body exceeds 16 KiB. Send a smaller request.",
			);
		}
		const input = await readQueryInput(request);
		const value = await tabs.query(id, input, controller.signal);
		if (!response.destroyed)
			response
				.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
				.end(JSON.stringify(value));
	} catch (error) {
		if (!response.destroyed)
			response
				.writeHead(error instanceof TabQueryError ? error.status : 500, {
					"Content-Type": "application/json; charset=utf-8",
				})
				.end(
					JSON.stringify({
						error:
							error instanceof TabQueryError
								? error.message
								: "Could not run this tab query. Check its command and retry.",
					}),
				);
	} finally {
		request.off("aborted", abort);
		response.off("close", abort);
	}
}

/** Call only after the server's host/origin checks, before its GET-only gate. */
export function serveCustomTabQuery(
	request: IncomingMessage,
	url: URL,
	response: ServerResponse,
	tabs: CustomTabs,
): boolean {
	const match = /^\/api\/tabs\/([a-z][a-z0-9-]*)\/query$/.exec(url.pathname);
	if (!match) return false;
	if (request.method !== "POST") {
		request.resume();
		response
			.writeHead(405, { Allow: "POST", "Content-Type": "application/json" })
			.end(JSON.stringify({ error: "Tab queries require POST." }));
	} else void queryTab(request, response, tabs, match[1] ?? "");
	return true;
}

/** Custom pages are embeddable; the dashboard itself is not. */
export function serveCustomTabs(
	url: URL,
	response: ServerResponse,
	tabs: CustomTabs,
): boolean {
	if (url.pathname === "/api/tabs") {
		response
			.writeHead(200, { "Content-Type": "application/json" })
			.end(JSON.stringify(tabs.list()));
		return true;
	}
	const snapshot = /^\/api\/tabs\/([a-z][a-z0-9-]*)$/.exec(url.pathname);
	if (snapshot) {
		const value = tabs.get(snapshot[1] ?? "");
		if (!value) response.writeHead(404).end();
		else
			response
				.writeHead(200, { "Content-Type": "application/json" })
				.end(JSON.stringify(value));
		return true;
	}
	const asset = /^\/tabs\/([a-z][a-z0-9-]*)\/(.*)$/.exec(url.pathname);
	if (!asset) return false;
	let path: string;
	try {
		path = decodeURIComponent(asset[2] ?? "");
	} catch {
		response.writeHead(400).end("Invalid tab asset path");
		return true;
	}
	void tabs.asset(asset[1] ?? "", path).then(
		(value) => {
			if (response.destroyed) return;
			if (!value) response.writeHead(404).end();
			else {
				response.setHeader(
					"Content-Security-Policy",
					"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
				);
				response.writeHead(200, { "Content-Type": value.type }).end(value.data);
			}
		},
		(error: unknown) => {
			console.error("Could not serve custom tab asset:", error);
			if (!response.destroyed)
				response
					.writeHead(500)
					.end("Could not load this tab asset. Check its bundle files.");
		},
	);
	return true;
}
