import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { formatNativeBinaryError } from "../../native-binary-error.ts";
import { getBundledToolBinaryPath } from "../native/binary.ts";

interface BridgeResponse<T = unknown> {
	request_id: number;
	ok: boolean;
	result?: T | undefined;
	error?: string | undefined;
}

export interface BridgeReadResponse {
	chunks: Array<{ seq: number; stream: "stdout" | "stderr" | "pty"; chunk: string }>;
	nextSeq: number;
	exited: boolean;
	exitCode?: number | null | undefined;
	closed: boolean;
	failure?: string | null | undefined;
}

export interface ExecBridgeClient {
	request<T = unknown>(request: Record<string, unknown>): Promise<T>;
	shutdown(): Promise<void>;
}

const MAX_BRIDGE_STDERR_CHARS = 16_000;
const BRIDGE_SHUTDOWN_TIMEOUT_MS = 5_000;
function appendBoundedText(current: string, next: string): string {
	const combined = `${current}${next}`;
	return combined.length > MAX_BRIDGE_STDERR_CHARS ? combined.slice(-MAX_BRIDGE_STDERR_CHARS) : combined;
}

export function formatExecBridgeExitError(stderr: string, code?: number | null | undefined, signal?: NodeJS.Signals | null | undefined): string {
	const detail = stderr.trim();
	const status = typeof code === "number" ? `code ${code}` : signal ? `signal ${signal}` : undefined;
	const prefix = status ? `exec_bridge exited (${status})` : "exec_bridge exited";
	const message = detail ? `${prefix}: ${detail}` : prefix;
	return formatNativeBinaryError("exec_bridge", message);
}

function formatExecBridgeWriteError(error: Error, stderr: string, startupWriteFailure: boolean): string {
	const detail = stderr.trim();
	return formatNativeBinaryError("exec_bridge", detail ? `${error.message}: ${detail}` : error, { startupWriteFailure });
}

export function createExecBridgeClient(binaryPath: () => string | undefined = () => getBundledToolBinaryPath("exec_bridge")): ExecBridgeClient {
	let bridge: ChildProcessWithoutNullStreams | undefined;
	let nextBridgeRequestId = 1;
	const pendingBridgeRequests = new Map<number, { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void }>();
	let bridgeLineBuffer = "";
	let bridgeStderr = "";
	let bridgeStdoutDecoder = new StringDecoder("utf8");
	let bridgeStderrDecoder = new StringDecoder("utf8");
	let bridgeClosing = false;
	let bridgeResponded = false;
	let bridgeShutdownPromise: Promise<void> | undefined;
	let bridgeClosed = false;

	function rejectPending(error: Error): void {
		for (const pending of pendingBridgeRequests.values()) pending.reject(error);
		pendingBridgeRequests.clear();
	}

	function handleStdout(data: Buffer): void {
		bridgeLineBuffer += bridgeStdoutDecoder.write(data);
		for (;;) {
			const newline = bridgeLineBuffer.indexOf("\n");
			if (newline === -1) break;
			const line = bridgeLineBuffer.slice(0, newline).trim();
			bridgeLineBuffer = bridgeLineBuffer.slice(newline + 1);
			if (!line) continue;
			let response: BridgeResponse;
			try { response = JSON.parse(line) as BridgeResponse; } catch { continue; }
			const pending = pendingBridgeRequests.get(response.request_id);
			if (!pending) continue;
			pendingBridgeRequests.delete(response.request_id);
			bridgeResponded = true;
			pending.resolve(response);
		}
	}

	function getBridge(): ChildProcessWithoutNullStreams {
		if (bridgeClosed) throw new Error("exec_bridge is shut down");
		if (bridge && !bridge.killed) return bridge;
		const binary = binaryPath();
		if (!binary) throw new Error(`exec_bridge binary is not bundled for ${process.platform}-${process.arch}`);
		bridgeClosing = false;
		bridgeLineBuffer = "";
		bridgeStderr = "";
		bridgeResponded = false;
		bridgeStdoutDecoder = new StringDecoder("utf8");
		bridgeStderrDecoder = new StringDecoder("utf8");
		bridge = spawn(binary, [], { stdio: "pipe", env: process.env });
		bridge.stdout.on("data", handleStdout);
		bridge.stderr.on("data", (data: Buffer) => {
			bridgeStderr = appendBoundedText(bridgeStderr, bridgeStderrDecoder.write(data));
		});
		bridge.stdin.on("error", (error: Error) => {
			rejectPending(new Error(formatExecBridgeWriteError(error, bridgeStderr, !bridgeResponded)));
		});
		bridge.on("close", (code, signal) => {
			bridgeLineBuffer += bridgeStdoutDecoder.end();
			bridgeStderr = appendBoundedText(bridgeStderr, bridgeStderrDecoder.end());
			rejectPending(new Error(bridgeClosing ? "exec_bridge closed" : formatExecBridgeExitError(bridgeStderr, code, signal)));
			bridge = undefined;
			bridgeLineBuffer = "";
			bridgeStderr = "";
		});
		bridge.on("error", (error) => rejectPending(new Error(formatNativeBinaryError("exec_bridge", error, { binaryPath: binary }))));
		return bridge;
	}

	async function sendRequest<T = unknown>(value: Record<string, unknown>, existingChild?: ChildProcessWithoutNullStreams): Promise<T> {
		const requestId = nextBridgeRequestId++;
		const child = existingChild ?? getBridge();
		const response = await new Promise<BridgeResponse<T>>((resolve, reject) => {
			pendingBridgeRequests.set(requestId, { resolve: resolve as (value: BridgeResponse) => void, reject });
			child.stdin.write(`${JSON.stringify({ ...value, request_id: requestId })}\n`, (error) => {
				if (!error) return;
				pendingBridgeRequests.delete(requestId);
				reject(new Error(formatExecBridgeWriteError(error, bridgeStderr, !bridgeResponded)));
			});
		});
		if (!response.ok) throw new Error(response.error ?? "exec_bridge request failed");
		return response.result as T;
	}

	async function request<T = unknown>(value: Record<string, unknown>): Promise<T> {
		if (bridgeClosed) throw new Error("exec_bridge is shut down");
		return sendRequest<T>(value);
	}

	async function shutdownBridge(): Promise<void> {
		bridgeClosed = true;
		const child = bridge;
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		const deadline = performance.now() + BRIDGE_SHUTDOWN_TIMEOUT_MS;
		const shutdownRequest = sendRequest({ op: "shutdown" }, child);
		bridgeClosing = true;
		try {
			await withTimeout(shutdownRequest, remainingMs(deadline), "exec_bridge shutdown timed out");
			await waitForBridgeClose(child, remainingMs(deadline));
		} catch (error) {
			if (child.exitCode === null && child.signalCode === null) killBridgeProcessTree(child);
			throw error;
		}
	}

	return {
		request,
		shutdown: () => bridgeShutdownPromise ??= shutdownBridge(),
	};
}

function killBridgeProcessTree(child: ChildProcessWithoutNullStreams): void {
	const pid = child.pid;
	if (pid && process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
			stdio: "ignore",
			timeout: 2_000,
			windowsHide: true,
		});
	} else if (pid) {
		killUnixDescendants(pid);
	}
	if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function killUnixDescendants(rootPid: number): void {
	const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid="], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 2_000,
	});
	if (result.status !== 0 || typeof result.stdout !== "string") return;
	const processes = result.stdout.split("\n").flatMap((line) => {
		const [pid, parentPid, processGroupId] = line.trim().split(/\s+/).map(Number);
		return pid && parentPid !== undefined && processGroupId
			? [{ pid, parentPid, processGroupId }]
			: [];
	});
	const descendants = new Set([rootPid]);
	for (;;) {
		let changed = false;
		for (const entry of processes) {
			if (!descendants.has(entry.parentPid) || descendants.has(entry.pid)) continue;
			descendants.add(entry.pid);
			changed = true;
		}
		if (!changed) break;
	}
	const ownProcessGroup = processes.find((entry) => entry.pid === process.pid)?.processGroupId;
	const groups = new Set(
		processes
			.filter((entry) => entry.pid !== rootPid && descendants.has(entry.pid))
			.map((entry) => entry.processGroupId)
			.filter((processGroupId) => processGroupId !== ownProcessGroup),
	);
	for (const processGroupId of groups) {
		try { process.kill(-processGroupId, "SIGKILL"); } catch {}
	}
	for (const pid of descendants) {
		if (pid === rootPid) continue;
		try { process.kill(pid, "SIGKILL"); } catch {}
	}
}

function remainingMs(deadline: number): number {
	return Math.max(0, deadline - performance.now());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
		}),
	]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}

function waitForBridgeClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return withTimeout(new Promise<void>((resolve) => child.once("close", () => resolve())), timeoutMs, "exec_bridge did not exit after shutdown");
}

export function chunkToBytes(chunk: string): Buffer {
	return Buffer.from(chunk, "base64");
}
