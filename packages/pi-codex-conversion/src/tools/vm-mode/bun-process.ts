import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VM_BUN_PROCESS_OVERHEAD_MIB } from "./limits.ts";
import type { VmCommand, VmMessage, VmProcessMessage } from "./protocol.ts";

const START_FAILED =
	"VM Code could not start a memory-limited Bun process. Use a full Bun build on Linux with a systemd user session, start Pi under Node.js or select Code in /codex settings";

export function startBunVmProcess(
	heapMiB: number,
	deliver: (message: VmMessage) => void,
	fail: (error?: Error) => void,
) {
	const runner = import.meta.url.endsWith(".ts")
		? new URL("./bun-runner.ts", import.meta.url)
		: new URL("./bun-runner.js", import.meta.url);
	const memoryMiB = heapMiB + VM_BUN_PROCESS_OVERHEAD_MIB;
	// Scope mode execs the interpreter in the same PID, preserving fork IPC
	// and letting us kill the capped process without a separate systemctl call.
	const child = fork(fileURLToPath(runner), [String(memoryMiB)], {
		cwd: fileURLToPath(new URL(".", runner)),
		execPath: "systemd-run",
		execArgv: [
			"--user",
			"--scope",
			"--quiet",
			"--collect",
			`--property=MemoryMax=${memoryMiB}M`,
			"--property=MemorySwapMax=0",
			"--",
			process.execPath,
			"--no-env-file",
			"--config=/dev/null",
			"run",
		],
		env: { ...process.env, BUN_BE_BUN: "1", BUN_OPTIONS: "" },
		serialization: "json",
		stdio: ["ignore", "ignore", "ignore", "ipc"],
	});
	let ready = false;
	let closed = false;
	let stopping = false;
	let fault: Error | undefined;
	const onError = (error: Error) => {
		if (closed || fault) return;
		fault = error;
		if (child.pid) child.kill("SIGKILL");
	};
	const done = new Promise<void>((resolve) => {
		child.once("close", (_code, signal) => {
			closed = true;
			fail(
				!ready
					? new Error(START_FAILED, { cause: fault })
					: signal === "SIGKILL" && !stopping && !fault
						? new Error(
								"VM Code was killed, possibly by its process memory limit. Conversation bindings were dropped. The next exec starts fresh",
							)
						: undefined,
			);
			resolve();
		});
	});
	child.on("error", onError);
	child.on("message", (message: VmProcessMessage) => {
		if (message.kind === "ready") ready = true;
		else deliver(message);
	});
	return {
		postMessage(command: VmCommand) {
			// Bun has no send method when spawning fails. Close reports the failure.
			if (!child.connected) return;
			child.send(command, (error) => {
				if (error) onError(error);
			});
		},
		async stop() {
			stopping = true;
			if (!closed && child.pid) child.kill("SIGKILL");
			await done;
		},
	};
}
