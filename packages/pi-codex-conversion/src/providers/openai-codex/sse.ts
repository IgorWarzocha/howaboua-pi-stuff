import type { StreamEventShape } from "./types.ts";

export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}

		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new Error("Request was aborted"));
			},
			{ once: true },
		);
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

export async function* parseSSE(response: Response, signal?: AbortSignal): AsyncIterable<StreamEventShape> {
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
			const { done, value } = await reader.read();
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
						} catch (error) {
							throw new Error(`Invalid Codex SSE JSON: ${error instanceof Error ? error.message : String(error)}`);
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
