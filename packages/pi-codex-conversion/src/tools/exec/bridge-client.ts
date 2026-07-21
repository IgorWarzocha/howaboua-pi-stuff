import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getBundledPathToolBinaryPath } from "../path/binary.ts";

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
	shutdown(): void;
}

const MAX_BRIDGE_STDERR_CHARS = 16_000;
const LOCAL_BUILD_GUIDANCE = "Bundled exec_bridge is incompatible with this Linux runtime. From a pi-codex-conversion Git checkout, run: bun install && bun run build:path-tool codex-exec-shim exec_bridge, then load that checkout's src/index.ts as the Pi extension";

function appendBoundedText(current: string, next: Buffer): string {
	const combined = `${current}${next.toString("utf8")}`;
	return combined.length > MAX_BRIDGE_STDERR_CHARS ? combined.slice(-MAX_BRIDGE_STDERR_CHARS) : combined;
}

export function formatExecBridgeExitError(stderr: string, code?: number | null | undefined, signal?: NodeJS.Signals | null | undefined): string {
	const detail = stderr.trim();
	const status = typeof code === "number" ? `code ${code}` : signal ? `signal ${signal}` : undefined;
	const prefix = status ? `exec_bridge exited (${status})` : "exec_bridge exited";
	const message = detail ? `${prefix}: ${detail}` : prefix;
	return withNativeBinaryGuidance(message);
}

function formatExecBridgeWriteError(error: Error, stderr: string): string {
	const detail = stderr.trim();
	return withNativeBinaryGuidance(detail ? `${error.message}: ${detail}` : error.message);
}

function withNativeBinaryGuidance(message: string): string {
	if (!isLinuxNativeLoaderFailure(message)) return message;
	return message.includes(LOCAL_BUILD_GUIDANCE) ? message : `${message}\n${LOCAL_BUILD_GUIDANCE}`;
}

function isLinuxNativeLoaderFailure(message: string): boolean {
	return /GLIBC_[0-9.]+.*not found|version [`']GLIBC_[0-9.]+[`'] not found|ld-linux|libc\.so/i.test(message);
}

export function createExecBridgeClient(): ExecBridgeClient {
	let bridge: ChildProcessWithoutNullStreams | undefined;
	let nextBridgeRequestId = 1;
	const pendingBridgeRequests = new Map<number, { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void }>();
	let bridgeLineBuffer = "";
	let bridgeStderr = "";
	let bridgeClosing = false;

	function rejectPending(error: Error): void {
		for (const pending of pendingBridgeRequests.values()) pending.reject(error);
		pendingBridgeRequests.clear();
	}

	function handleStdout(data: Buffer): void {
		bridgeLineBuffer += data.toString("utf8");
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
			pending.resolve(response);
		}
	}

	function getBridge(): ChildProcessWithoutNullStreams {
		if (bridge && !bridge.killed) return bridge;
		const binary = getBundledPathToolBinaryPath("exec_bridge");
		if (!binary) throw new Error(`exec_bridge binary is not bundled for ${process.platform}-${process.arch}`);
		bridgeClosing = false;
		bridgeStderr = "";
		bridge = spawn(binary, [], { stdio: "pipe", env: process.env });
		bridge.stdout.on("data", handleStdout);
		bridge.stderr.on("data", (data: Buffer) => {
			bridgeStderr = appendBoundedText(bridgeStderr, data);
		});
		bridge.stdin.on("error", (error: Error) => {
			rejectPending(new Error(formatExecBridgeWriteError(error, bridgeStderr)));
		});
		bridge.on("close", (code, signal) => {
			rejectPending(new Error(bridgeClosing ? "exec_bridge closed" : formatExecBridgeExitError(bridgeStderr, code, signal)));
			bridge = undefined;
			bridgeStderr = "";
		});
		bridge.on("error", rejectPending);
		return bridge;
	}

	return {
		async request<T = unknown>(request: Record<string, unknown>): Promise<T> {
			const requestId = nextBridgeRequestId++;
			const child = getBridge();
			const response = await new Promise<BridgeResponse<T>>((resolve, reject) => {
				pendingBridgeRequests.set(requestId, { resolve: resolve as (value: BridgeResponse) => void, reject });
				child.stdin.write(`${JSON.stringify({ ...request, request_id: requestId })}\n`, (error) => {
					if (!error) return;
					pendingBridgeRequests.delete(requestId);
					reject(new Error(formatExecBridgeWriteError(error, bridgeStderr)));
				});
			});
			if (!response.ok) throw new Error(response.error ?? "exec_bridge request failed");
			return response.result as T;
		},
		shutdown() {
			if (bridge && !bridge.killed) {
				bridgeClosing = true;
				bridge.kill();
			}
		},
	};
}

export function chunkToText(chunk: string): string {
	return Buffer.from(chunk, "base64").toString("utf8");
}
