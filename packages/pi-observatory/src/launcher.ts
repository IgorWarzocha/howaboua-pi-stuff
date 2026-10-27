import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { hyperlink } from "@earendil-works/pi-tui";
import {
	loadConfig,
	type ObservatoryConfig,
	PROTOCOL,
	sourceId,
	stateDirectory,
} from "./config.ts";
import { object } from "./normalise.ts";
import { saveTheme } from "./theme.ts";

async function available(
	origin: string,
	config: ObservatoryConfig,
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
			"The Observatory port is occupied by another application. Change its port in config.json.",
		);
	}
	const health = object(value);
	if (!response.ok || health["protocol"] !== PROTOCOL)
		throw new Error(
			"The Observatory port is occupied by another application or an older viewer. Stop that process or change the port, then run /observatory again.",
		);
	if (
		health["host"] !== config.host ||
		health["publicUrl"] !== config.publicUrl ||
		health["sourceId"] !== sourceId(config)
	)
		throw new Error(
			`Observatory configuration changed. Restart its server (PID ${health["pid"]}), then run /observatory again.`,
		);
	return true;
}

async function ensureServer(config: ObservatoryConfig): Promise<string> {
	const origin = `http://127.0.0.1:${config.port}`;
	if (await available(origin, config)) return origin;
	await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
	const path = join(stateDirectory(), "server.log");
	const log = openSync(path, "a", 0o600);
	let failure: Error | undefined;
	try {
		const child = spawn(
			process.versions["bun"] ? "node" : process.execPath,
			[
				fileURLToPath(new URL("./server.js", import.meta.url)),
				"--defer-initial-update",
			],
			{ detached: true, stdio: ["ignore", log, log], windowsHide: true },
		);
		child.once("error", (error) => {
			failure = error;
		});
		child.once("exit", (code) => {
			if (code !== 0)
				failure = new Error(`Observatory did not start. Check ${path}.`);
		});
		child.unref();
	} finally {
		closeSync(log);
	}
	for (let attempt = 0; attempt < 40; attempt++) {
		if (await available(origin, config)) return origin;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw failure ?? new Error(`Observatory did not start. Check ${path}.`);
}

export async function openObservatory(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	try {
		const config = await loadConfig();
		const origin = await ensureServer(config);
		await saveTheme(ctx.ui.theme);
		const session = encodeURIComponent(ctx.sessionManager.getSessionId());
		const response = await fetch(`${origin}/api/open?session=${session}`, {
			method: "POST",
			signal: AbortSignal.timeout(3000),
		});
		const value = object(await response.json());
		if (!response.ok || typeof value["url"] !== "string")
			throw new Error(
				"Could not open Observatory. Restart its server and run /observatory again.",
			);
		const url = value["url"];
		ctx.ui.notify(hyperlink(url, url), "info");
		if (!config.openCommand) return;
		const [command, ...args] = config.openCommand;
		if (!command) return;
		try {
			const result = await pi.exec(command, [...args, url], { timeout: 5000 });
			if (result.code !== 0) throw new Error("Browser opener failed");
		} catch {
			ctx.ui.notify(
				"Observatory is ready, but the browser did not open. Open the link above.",
				"warning",
			);
		}
	} catch (error) {
		ctx.ui.notify(
			`Observatory: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	}
}
