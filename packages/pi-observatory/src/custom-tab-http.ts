import type { ServerResponse } from "node:http";
import type { CustomTabs } from "./custom-tabs/index.ts";

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
