import { spawn } from "node:child_process";

const OUTPUT_LIMIT_BYTES = 8 * 1_024 * 1_024;

export interface ProcessResult {
	code: number;
	stderr: string;
	stdout: string;
}

export function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new Error("Remote browser operation aborted");
}

export function runProgram(
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
