import type * as NodeZlib from "node:zlib";
import type { StreamEventShape } from "./types.ts";

const REQUEST_COMPRESSION_ZSTD_LEVEL = 3;

type ProcessWithBuiltinModule = typeof process & {
	getBuiltinModule?: (id: "node:zlib") => typeof NodeZlib;
};

export function compressRequestBodyZstd(bodyJson: string): Uint8Array | null {
	const zlib = (process as ProcessWithBuiltinModule).getBuiltinModule?.("node:zlib");
	if (!zlib || typeof zlib.zstdCompressSync !== "function") return null;
	try {
		const compressed = zlib.zstdCompressSync(bodyJson, {
			params: { [zlib.constants.ZSTD_c_compressionLevel]: REQUEST_COMPRESSION_ZSTD_LEVEL },
		});
		return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
	} catch {
		return null;
	}
}

export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}

		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			reject(new Error("Request was aborted"));
		};
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

export function normalizeTimeoutMs(value: number | undefined, optionName: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid ${optionName}: ${String(value)}`);
	}
	return Math.floor(value);
}

export function combineAbortSignals(signals: Array<AbortSignal | undefined>): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
	for (const signal of signals) {
		if (!signal) continue;
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		const listener = () => controller.abort(signal.reason);
		signal.addEventListener("abort", listener);
		listeners.push({ signal, listener });
	}
	return {
		signal: controller.signal,
		cleanup: () => {
			for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
		},
	};
}

export function createSSEHeaderTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void; error: () => Error | undefined } {
	const controller = new AbortController();
	let error: Error | undefined;
	const timeout = setTimeout(() => {
		error = new Error(`Codex SSE response headers timed out after ${timeoutMs}ms`);
		controller.abort(error);
	}, timeoutMs);
	return {
		signal: controller.signal,
		clear: () => clearTimeout(timeout),
		error: () => error,
	};
}

export async function* parseSSE(response: Response, signal?: AbortSignal, idleTimeoutMs?: number): AsyncIterable<StreamEventShape> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			let idleTimer: ReturnType<typeof setTimeout> | undefined;
			const read = reader.read();
			const { done, value } = idleTimeoutMs === undefined || idleTimeoutMs <= 0
				? await read
				: await Promise.race([
					read,
					new Promise<never>((_resolve, reject) => {
						idleTimer = setTimeout(() => reject(new Error(`Codex SSE stream idle timeout after ${idleTimeoutMs}ms`)), idleTimeoutMs);
					}),
				]).finally(() => {
					if (idleTimer) clearTimeout(idleTimer);
				});
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const trailingCarriageReturn = buffer.endsWith("\r");
			const complete = trailingCarriageReturn ? buffer.slice(0, -1) : buffer;
			buffer = complete.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
				+ (trailingCarriageReturn ? "\r" : "");
			let idx = buffer.indexOf("\n\n");
			while (idx !== -1) {
				const chunk = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const dataLines = chunk
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trim());
				if (dataLines.length > 0) {
					const data = dataLines.join("\n").trim();
					if (data && data !== "[DONE]") {
						try {
							yield JSON.parse(data) as StreamEventShape;
						} catch {
							// Codex ignores malformed individual events and keeps the live stream.
						}
					}
				}
				idx = buffer.indexOf("\n\n");
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {
			// ignore cancellation errors
		}
		try {
			reader.releaseLock();
		} catch {
			// ignore lock release errors
		}
	}
}
