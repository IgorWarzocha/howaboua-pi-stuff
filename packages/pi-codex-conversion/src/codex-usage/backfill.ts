import { spawn } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { WEEK_MS } from "./ledger.ts";
import { parseUsageHistory, type UsageHistoryScan } from "./ledger-schema.ts";
import { runLedgerOperation } from "./ledger-store.ts";

const scans = new Map<string, Promise<void>>();

export function usageSessionRoot(sessionDir: string): string {
	const standardRoot = join(getAgentDir(), "sessions");
	const path = relative(standardRoot, sessionDir);
	return path.startsWith("..") || isAbsolute(path) ? sessionDir : standardRoot;
}

function scanInChild(root: string, from: number, to: number, windowStart: number, signal: AbortSignal): Promise<UsageHistoryScan> {
	const script = fileURLToPath(new URL(`./analyse.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url));
	return new Promise((resolve, reject) => {
		const child = spawn("node", [script, "history", "--root", root, "--from", new Date(from).toISOString(), "--to", new Date(to).toISOString(), "--window-start", new Date(windowStart).toISOString()], {
			stdio: ["ignore", "pipe", "pipe"], signal,
		});
		let output = "", error = "", bytes = 0;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			bytes += Buffer.byteLength(chunk);
			if (bytes > 32 * 1024 * 1024) {
				child.kill();
				reject(new Error("Session history exceeds the 32 MiB import limit; no history was imported."));
			} else output += chunk;
		});
		child.stderr.on("data", (chunk: string) => { error = (error + chunk).slice(-4096); });
		child.once("error", reject);
		child.once("close", (code) => {
			if (code !== 0) { reject(new Error(error.trim() || `Session history scan exited ${code}`)); return; }
			try { resolve(parseUsageHistory(JSON.parse(output))); }
			catch (failure) { reject(failure); }
		});
	});
}

export function backfillUsage(
	key: string,
	sessionDir: string,
	signal?: AbortSignal,
): Promise<void> {
	const running = scans.get(key);
	if (running) return running;
	const boundedSignal = AbortSignal.any([
		...(signal ? [signal] : []),
		AbortSignal.timeout(120_000),
	]);
	const task = (async () => {
		boundedSignal.throwIfAborted();
		const reservation = await runLedgerOperation(key, Date.now(), {
			kind: "reserve-history",
		});
		if (reservation.kind !== "history") return;
		const { start, to } = reservation,
			from = start - WEEK_MS;
		if (to <= from) return;
		const root = usageSessionRoot(sessionDir);
		const history = await scanInChild(root, from, to, start, boundedSignal);
		boundedSignal.throwIfAborted();
		await runLedgerOperation(key, Date.now(), {
			kind: "import-history",
			history,
		});
	})().finally(() => {
		if (scans.get(key) === task) scans.delete(key);
	});
	scans.set(key, task);
	return task;
}
