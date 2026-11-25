import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { API } from "tsrs/async";
import { bridgeCompilerStdio } from "./compiler-stdio.ts";
import type { TsRuntime } from "./runtime.ts";

export interface TsCompilerProcess {
	api: API;
	close(): Promise<void>;
}

/** Own the API server so its optimization policy never changes Pi's environment. */
export async function startTsCompiler(
	runtime: TsRuntime,
	options: { cwd: string; tsserverPath?: string },
): Promise<TsCompilerProcess> {
	const windows = process.platform === "win32";
	const id = `pi-ts-${randomUUID()}`;
	const directory = join(tmpdir(), id);
	const pipe = windows ? `\\\\.\\pipe\\${id}` : join(directory, "socket");
	const args = ["--api", "--async", "--cwd", options.cwd];
	if (!windows) args.push("--pipe", directory);
	// Keep the notebook's optimized compiler policy; an explicit user environment wins.
	const command = options.tsserverPath ?? process.execPath;
	const commandArgs = options.tsserverPath ? args : [runtime.launcher, ...args];
	const processOptions = {
		cwd: options.cwd,
		env: { ...process.env, TSRS_FAST: process.env["TSRS_FAST"] ?? "1" },
	};
	// tsrs' synchronous Windows pipe handle cannot service concurrent async reads and writes.
	const stdioCompiler = windows
		? spawn(command, commandArgs, {
				...processOptions,
				stdio: ["pipe", "pipe", "inherit"],
			})
		: undefined;
	const child =
		stdioCompiler ??
		spawn(command, commandArgs, {
			...processOptions,
			detached: true,
			stdio: ["ignore", "ignore", "inherit"],
		});
	const bridge = stdioCompiler
		? bridgeCompilerStdio(stdioCompiler, pipe)
		: undefined;
	let failure: Error | undefined;
	child.once("error", (error) => {
		failure = error;
	});
	const closed = new Promise<void>((resolve) =>
		child.once("close", () => resolve()),
	);
	let api = new runtime.api.API({ pipe });
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> =>
		(closing ??= (async () => {
			try {
				await api.close();
			} finally {
				bridge?.close();
				try {
					if (
						child.pid &&
						child.exitCode === null &&
						child.signalCode === null
					) {
						if (windows)
							await new Promise<void>((resolve, reject) =>
								execFile(
									"taskkill",
									["/pid", String(child.pid), "/T", "/F"],
									(error) => {
										if (
											error &&
											child.exitCode === null &&
											child.signalCode === null
										)
											reject(error);
										else resolve();
									},
								),
							);
						else {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch (error) {
								if (
									!(
										error instanceof Error &&
										"code" in error &&
										error.code === "ESRCH"
									)
								)
									// oxlint-disable-next-line no-unsafe-finally -- Cleanup failure must remain visible, even when the primary operation failed.
									throw error;
							}
						}
					}
					await closed;
				} finally {
					if (!windows) await rm(directory, { recursive: true, force: true });
				}
			}
		})());
	try {
		await bridge?.listen();
		const deadline = performance.now() + 15_000;
		while (true) {
			if (failure) throw failure;
			if (child.exitCode !== null || child.signalCode !== null)
				throw new Error("TS compiler stopped during startup");
			try {
				await api.parseCommandLine([]);
				break;
			} catch (error) {
				await api.close();
				if (
					!(
						error instanceof Error && /ENOENT|ECONNREFUSED/.test(error.message)
					) ||
					performance.now() >= deadline
				)
					throw error;
				await setTimeout(10);
				api = new runtime.api.API({ pipe });
			}
		}
		return { api, close };
	} catch (error) {
		await close();
		throw error;
	}
}
