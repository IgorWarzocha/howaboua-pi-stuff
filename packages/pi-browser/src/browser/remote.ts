import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { artifactDirectory } from "./artifacts.js";
import type { BrowserOperation } from "./operation.js";
import type { BrowserRemoteCommand, BrowserRoute } from "./routes.js";

const OUTPUT_LIMIT_BYTES = 8 * 1_024 * 1_024;
const SAFE_REMOTE_FILE = /^\/[A-Za-z0-9_./-]+$/;

interface ProcessResult {
	code: number;
	stderr: string;
	stdout: string;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new Error("Remote browser operation aborted");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function remoteNodeCommand(command: BrowserRemoteCommand): string {
	return `${command.nodePath} --preserve-symlinks-main ${command.toolPath} --parsed`;
}

function runProgram(
	command: string,
	args: string[],
	input: string | undefined,
	signal?: AbortSignal,
): Promise<ProcessResult> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolveValue, reject) => {
		const child = spawn(command, args, {
			stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let bytes = 0;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const running = () => child.exitCode === null && child.signalCode === null;
		const cleanup = () => {
			if (killTimer) clearTimeout(killTimer);
			signal?.removeEventListener("abort", abort);
		};
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			action();
		};
		const abort = () => {
			if (running()) child.kill("SIGTERM");
			killTimer = setTimeout(() => {
				if (running()) child.kill("SIGKILL");
			}, 1_000);
			killTimer.unref?.();
		};
		const append = (target: "stderr" | "stdout", chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > OUTPUT_LIMIT_BYTES) {
				if (running()) child.kill("SIGKILL");
				finish(() => reject(new Error("Remote browser output exceeded 8 MiB")));
				return;
			}
			if (target === "stdout") stdout += chunk.toString("utf8");
			else stderr += chunk.toString("utf8");
		};
		child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
		child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) =>
			finish(() => {
				if (signal?.aborted) {
					reject(abortReason(signal));
					return;
				}
				resolveValue({
					code: code ?? 1,
					stderr: stderr.trim(),
					stdout: stdout.trim(),
				});
			}),
		);
		if (input !== undefined) child.stdin?.end(input);
		signal?.addEventListener("abort", abort, { once: true });
	});
}

async function copyRemoteArtifact(
	host: string,
	remoteFile: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!SAFE_REMOTE_FILE.test(remoteFile)) {
		throw new Error(
			`remote browser returned an unsafe artifact path: ${remoteFile}`,
		);
	}
	await mkdir(artifactDirectory(), { recursive: true, mode: 0o700 });
	const localFile = join(
		artifactDirectory(),
		`${host}-${basename(remoteFile)}`,
	);
	const copied = await runProgram(
		"scp",
		["-q", `${host}:${remoteFile}`, localFile],
		undefined,
		signal,
	);
	if (copied.code !== 0) {
		throw new Error(
			copied.stderr || copied.stdout || "could not copy remote screenshot",
		);
	}
	try {
		const removed = await runProgram(
			"ssh",
			[host, `/usr/bin/rm -- ${remoteFile}`],
			undefined,
			signal,
		);
		if (removed.code !== 0) {
			throw new Error(
				removed.stderr ||
					removed.stdout ||
					"copied screenshot but could not remove remote artifact",
			);
		}
		return localFile;
	} catch (error) {
		await rm(localFile, { force: true });
		throw error;
	}
}

async function localizeScreenshots(
	host: string,
	operations: BrowserOperation[],
	result: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<void> {
	for (const [index, operation] of operations.entries()) {
		if (operation.action !== "screenshot") continue;
		const item =
			operations.length === 1
				? result
				: Array.isArray(result["results"])
					? result["results"][index]
					: undefined;
		if (!isRecord(item) || typeof item["file"] !== "string") {
			throw new Error(`remote screenshot result ${index} has no file path`);
		}
		item["file"] = await copyRemoteArtifact(host, item["file"], signal);
	}
}

export async function executeRemoteBrowser(
	route: BrowserRoute,
	operations: BrowserOperation[],
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (!route.remote) {
		throw new Error(`Browser host ${route.name} has no remote command`);
	}
	const executed = await runProgram(
		"ssh",
		[route.name, remoteNodeCommand(route.remote)],
		JSON.stringify({ operations }),
		signal,
	);
	if (executed.code !== 0) {
		throw new Error(
			executed.stderr ||
				executed.stdout ||
				`remote browser exited with code ${executed.code}`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(executed.stdout);
	} catch (error) {
		throw new Error(
			`remote browser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) {
		throw new Error("remote browser result is not an object");
	}
	await localizeScreenshots(route.name, operations, value, signal);
	return value;
}
