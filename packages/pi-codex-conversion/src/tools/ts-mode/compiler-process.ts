import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { API } from "tsrs/async";
import type { TsRuntime } from "./runtime.ts";

export interface TsCompilerProcess {
	api: API;
	close(): Promise<void>;
}

/** Own the API server so its optimization policy never changes Pi's environment. */
export async function startTsCompiler(runtime: TsRuntime, options: { cwd: string; tsserverPath?: string }): Promise<TsCompilerProcess> {
	const directory = join(tmpdir(), `pi-ts-${randomUUID()}`);
	const pipe = process.platform === "win32" ? `\\\\.\\pipe\\pi-ts-${randomUUID()}` : join(directory, "socket");
	const args = ["--api", "--async", "--cwd", options.cwd, "--pipe", process.platform === "win32" ? pipe : directory];
	// Keep the notebook's optimized compiler policy; an explicit user environment wins.
	const child = spawn(options.tsserverPath ?? process.execPath, options.tsserverPath ? args : [runtime.launcher, ...args], {
		cwd: options.cwd, env: { ...process.env, TSRS_FAST: process.env["TSRS_FAST"] ?? "1" },
		detached: process.platform !== "win32", stdio: ["ignore", "ignore", "inherit"],
	});
	let failure: Error | undefined;
	child.once("error", error => { failure = error; });
	const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
	let api = new runtime.api.API({ pipe });
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => closing ??= (async () => {
		try { await api.close(); }
		finally {
			try {
				if (child.pid && child.exitCode === null && child.signalCode === null) {
					if (process.platform === "win32") await new Promise<void>((resolve, reject) => execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], error => {
						if (error && child.exitCode === null && child.signalCode === null) reject(error); else resolve();
					}));
					else {
						try { process.kill(-child.pid, "SIGKILL"); }
						catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
					}
				}
				await closed;
			} finally { if (process.platform !== "win32") await rm(directory, { recursive: true, force: true }); }
		}
	})();
	try {
		const deadline = performance.now() + 15_000;
		while (true) {
			if (failure) throw failure;
			if (child.exitCode !== null || child.signalCode !== null) throw new Error("TS compiler stopped during startup");
			try { await api.parseCommandLine([]); break; }
			catch (error) {
				await api.close();
				if (!(error instanceof Error && /ENOENT|ECONNREFUSED/.test(error.message)) || performance.now() >= deadline) throw error;
				await setTimeout(10);
				api = new runtime.api.API({ pipe });
			}
		}
		return { api, close };
	} catch (error) { await close(); throw error; }
}
