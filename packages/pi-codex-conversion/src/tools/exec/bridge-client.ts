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

export function createExecBridgeClient(): ExecBridgeClient {
	let bridge: ChildProcessWithoutNullStreams | undefined;
	let nextBridgeRequestId = 1;
	const pendingBridgeRequests = new Map<number, { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void }>();
	let bridgeLineBuffer = "";
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
		bridge = spawn(binary, [], { stdio: "pipe", env: process.env });
		bridge.stdout.on("data", handleStdout);
		bridge.stderr.on("data", (data: Buffer) => { void data; });
		bridge.on("close", () => {
			rejectPending(new Error(bridgeClosing ? "exec_bridge closed" : "exec_bridge exited"));
			bridge = undefined;
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
					reject(error);
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

