import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BrowserOperation } from "./operation.js";
import { isRecordValue, parseActionRequest } from "./parse-operation.js";
import { BrowserRoutes } from "./routes.js";
import { BrowserRuntime } from "./runtime.js";

const INPUT_LIMIT_BYTES = 8 * 1_024 * 1_024;
const START_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 20 * 60 * 1_000;
const IS_WINDOWS = process.platform === "win32";

interface WorkerResponse {
	error?: string;
	ok: boolean;
	result?: Record<string, unknown>;
}

function workerSocketPath(workerId: string): string {
	if (IS_WINDOWS) return `\\\\.\\pipe\\pi-browser-worker-${workerId}`;
	const directory = process.env["XDG_RUNTIME_DIR"]
		? join(process.env["XDG_RUNTIME_DIR"], "browser-tool")
		: join(tmpdir(), `browser-tool-${process.getuid?.() ?? "user"}`);
	return join(directory, `worker-${workerId}.sock`);
}

function parseWorkerOperations(input: string): BrowserOperation[] {
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch (error) {
		throw new Error(
			`worker input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecordValue(value)) throw new Error("worker input must be an object");
	const unknown = Object.keys(value).filter((key) => key !== "operations");
	if (unknown.length > 0) {
		throw new Error(`unknown worker field(s): ${unknown.join(", ")}`);
	}
	if (!Array.isArray(value["operations"]) || value["operations"].length === 0) {
		throw new Error("worker operations must be a non-empty array");
	}
	return value["operations"].map((operation, index) => {
		if (!isRecordValue(operation)) {
			throw new Error(`worker operations[${index}] must be an object`);
		}
		const parsed = parseActionRequest(operation);
		if (parsed.action === "help") {
			throw new Error("help is not a worker operation");
		}
		return parsed;
	});
}

function readLine(socket: Socket): Promise<string> {
	return new Promise((resolveValue, reject) => {
		let input = "";
		let bytes = 0;
		const cleanup = () => {
			socket.off("data", onData);
			socket.off("end", onEnd);
			socket.off("error", onError);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onEnd = () => onError(new Error("Browser worker closed early"));
		const onData = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > INPUT_LIMIT_BYTES) {
				cleanup();
				reject(new Error("Browser worker input exceeded 8 MiB"));
				return;
			}
			input += chunk.toString("utf8");
			const newline = input.indexOf("\n");
			if (newline < 0) return;
			cleanup();
			resolveValue(input.slice(0, newline));
		};
		socket.on("data", onData);
		socket.once("end", onEnd);
		socket.once("error", onError);
	});
}

async function handleConnection(
	socket: Socket,
	runtime: BrowserRuntime,
): Promise<void> {
	let response: WorkerResponse;
	try {
		const operations = parseWorkerOperations(await readLine(socket));
		response = {
			ok: true,
			result: await runtime.execute({ operations }),
		};
	} catch (error) {
		response = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	socket.end(`${JSON.stringify(response)}\n`);
}

export async function serveBrowserWorker(workerId: string): Promise<void> {
	const path = workerSocketPath(workerId);
	if (!IS_WINDOWS) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const runtime = new BrowserRuntime(new BrowserRoutes());
	let ownsSocket = false;
	const server = createServer((socket) => {
		resetIdle();
		void handleConnection(socket, runtime).finally(resetIdle);
	});
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const close = () => server.close();
	const resetIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(close, IDLE_TIMEOUT_MS);
		idleTimer.unref?.();
	};
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	try {
		await new Promise<void>((resolveValue, reject) => {
			server.once("error", reject);
			server.listen(path, () => {
				ownsSocket = true;
				server.off("error", reject);
				resetIdle();
			});
			server.once("close", resolveValue);
		});
	} finally {
		if (idleTimer) clearTimeout(idleTimer);
		process.removeListener("SIGINT", close);
		process.removeListener("SIGTERM", close);
		runtime.close();
		if (!IS_WINDOWS && ownsSocket) await rm(path, { force: true });
	}
}

function requestOnce(
	input: string,
	workerId: string,
	signal?: AbortSignal,
): Promise<WorkerResponse> {
	if (signal?.aborted) {
		return Promise.reject(
			signal.reason ?? new Error("Browser worker request aborted"),
		);
	}
	return new Promise((resolveValue, reject) => {
		const socket = createConnection(workerSocketPath(workerId));
		const abort = () => {
			socket.destroy();
			reject(signal?.reason ?? new Error("Browser worker request aborted"));
		};
		signal?.addEventListener("abort", abort, { once: true });
		socket.once("connect", () => socket.write(`${input}\n`));
		void readLine(socket).then(
			(line) => {
				signal?.removeEventListener("abort", abort);
				socket.destroy();
				try {
					const response: unknown = JSON.parse(line);
					if (!isRecordValue(response) || typeof response["ok"] !== "boolean") {
						throw new Error("Browser worker returned an invalid response");
					}
					resolveValue(response as unknown as WorkerResponse);
				} catch (error) {
					reject(error);
				}
			},
			(error) => {
				signal?.removeEventListener("abort", abort);
				socket.destroy();
				reject(error);
			},
		);
	});
}

function canStartWorker(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ECONNREFUSED")
	);
}

export async function requestBrowserWorker(
	input: string,
	entryPath: string,
	workerId: string,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	try {
		const response = await requestOnce(input, workerId, signal);
		if (!response.ok)
			throw new Error(response.error ?? "Browser worker failed");
		if (!response.result) throw new Error("Browser worker returned no result");
		return response.result;
	} catch (error) {
		if (!canStartWorker(error)) throw error;
	}
	if (!IS_WINDOWS) await rm(workerSocketPath(workerId), { force: true });
	const child = spawn(
		process.execPath,
		["--preserve-symlinks-main", entryPath, "--daemon"],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();
	const deadline = Date.now() + START_TIMEOUT_MS;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const response = await requestOnce(input, workerId, signal);
			if (!response.ok)
				throw new Error(response.error ?? "Browser worker failed");
			if (!response.result)
				throw new Error("Browser worker returned no result");
			return response.result;
		} catch (error) {
			if (!canStartWorker(error)) throw error;
			lastError = error;
			await new Promise((resolveValue) => setTimeout(resolveValue, 50));
		}
	}
	throw new Error(
		`Browser worker did not start within ${START_TIMEOUT_MS}ms${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
	);
}
