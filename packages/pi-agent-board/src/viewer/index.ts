import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	accessKey,
	loadConfig,
	stateDirectory,
	type ViewerConfig,
} from "./config.ts";
import type { ViewSource } from "./contracts.ts";
import { parseSource } from "./source.ts";

export type ViewerSource = (
	ctx: ExtensionContext,
	sessionName: string | undefined,
) => ViewSource | Promise<ViewSource>;

const PROTOCOL = "pi-board-viewer/1";
async function available(
	origin: string,
	config: ViewerConfig,
): Promise<boolean> {
	let response: Response;
	try {
		response = await fetch(`${origin}/api/health`, {
			signal: AbortSignal.timeout(700),
		});
	} catch {
		return false;
	}
	let value: unknown;
	try {
		value = await response.json();
	} catch {
		throw new Error(
			"The viewer port is occupied by another application; change the viewer port",
		);
	}
	if (
		!response.ok ||
		!value ||
		typeof value !== "object" ||
		!("protocol" in value) ||
		value.protocol !== PROTOCOL
	)
		throw new Error(
			"The viewer port is occupied by another application or viewer version",
		);
	if (
		!("host" in value) ||
		value.host !== config.host ||
		!("publicUrl" in value) ||
		value.publicUrl !== config.publicUrl
	) {
		const process =
			"pid" in value && typeof value.pid === "number"
				? ` process ${value.pid}`
				: " server";
		throw new Error(
			`Viewer configuration changed. Restart the viewer${process}, then run /board again`,
		);
	}
	return true;
}

async function ensureServer(config: ViewerConfig): Promise<string> {
	const origin = `http://127.0.0.1:${config.port}`;
	if (await available(origin, config)) return origin;
	const log = openSync(join(stateDirectory(), "server.log"), "a", 0o600);
	let failure: Error | undefined;
	try {
		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL("../../dist/viewer/server.js", import.meta.url))],
			{ detached: true, stdio: ["ignore", log, log], windowsHide: true },
		);
		child.once("error", (error) => {
			failure = error;
		});
		child.unref();
	} finally {
		closeSync(log);
	}
	for (let attempt = 0; attempt < 30; attempt++) {
		if (failure) throw failure;
		if (await available(origin, config)) return origin;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Board viewer did not start. Check ${join(stateDirectory(), "server.log")}`,
	);
}

export async function openBoardViewer(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	source: ViewerSource,
): Promise<void> {
	try {
		const view = parseSource(await source(ctx, pi.getSessionName()));
		const config = await loadConfig();
		const key = await accessKey();
		const origin = await ensureServer(config);
		const response = await fetch(`${origin}/api/open`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(view),
			signal: AbortSignal.timeout(10_000),
		});
		const value: unknown = await response.json();
		if (
			!response.ok ||
			!value ||
			typeof value !== "object" ||
			!("url" in value) ||
			typeof value.url !== "string"
		) {
			throw new Error(
				value &&
					typeof value === "object" &&
					"error" in value &&
					typeof value.error === "string"
					? value.error
					: "Could not open the board viewer",
			);
		}
		const url = value.url;
		ctx.ui.notify(url, "info");
		if (config.openCommand) {
			const [command, ...commandArgs] = config.openCommand;
			if (!command) return;
			try {
				const result = await pi.exec(command, [...commandArgs, url], {
					timeout: 5_000,
				});
				if (result.code !== 0) throw new Error("Browser opener failed");
			} catch {
				ctx.ui.notify(
					"The viewer is ready, but the browser did not open. Open the link above.",
					"warning",
				);
			}
		}
	} catch (error) {
		ctx.ui.notify(
			`Board viewer: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	}
}
