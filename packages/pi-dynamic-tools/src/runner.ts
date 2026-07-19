import { spawn } from "node:child_process";
import type { DynamicToolDefinition } from "./types.js";

const MAX_OUTPUT_BYTES = 50 * 1024;

export async function runDynamicTool(
	tool: DynamicToolDefinition,
	input: unknown,
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	if (tool.disabledReason)
		throw new Error(`${tool.name} is disabled: ${tool.disabledReason}`);
	if (typeof input !== "string")
		throw new Error(`${tool.name} expects a string input`);
	if (signal?.aborted) throw new Error(`${tool.name} aborted`);
	const args = tool.input === "arg" ? [...tool.args, input] : [...tool.args];
	return new Promise<string>((resolve, reject) => {
		const child = spawn(tool.command, args, {
			cwd,
			shell: false,
			detached: process.platform !== "win32",
			stdio: [tool.input === "stdin" ? "pipe" : "ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let bytes = 0;
		let settled = false;
		const kill = () => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				child.kill();
			}
		};
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			callback();
		};
		const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
			const text = chunk.toString();
			bytes += Buffer.byteLength(text);
			if (bytes > MAX_OUTPUT_BYTES) {
				kill();
				finish(() =>
					reject(
						new Error(`${tool.name} output exceeded ${MAX_OUTPUT_BYTES} bytes`),
					),
				);
				return;
			}
			if (target === "stdout") stdout += text;
			else stderr += text;
		};
		const onAbort = () => {
			kill();
			finish(() => reject(new Error(`${tool.name} aborted`)));
		};
		child.stdout?.on("data", (chunk) => append("stdout", chunk));
		child.stderr?.on("data", (chunk) => append("stderr", chunk));
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) =>
			finish(() => {
				if (code !== 0) {
					reject(
						new Error(
							`${tool.name} exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
						),
					);
					return;
				}
				resolve(stdout.trimEnd() || stderr.trimEnd() || "(no output)");
			}),
		);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (tool.input === "stdin") child.stdin?.end(input);
	});
}
