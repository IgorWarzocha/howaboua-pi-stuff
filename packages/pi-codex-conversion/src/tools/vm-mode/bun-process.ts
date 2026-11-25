import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VM_BUN_PROCESS_OVERHEAD_MIB, VM_BUN_WATCHDOG_EXIT } from "./limits.ts";
import type { VmCommand, VmMessage, VmProcessMessage } from "./protocol.ts";

const NEXT_STEP = "Start Pi under Node.js or select Code in /codex settings";
const MEMORY_LIMIT =
	"VM Code exceeded its process memory budget. Conversation bindings dropped. Next exec starts fresh.";

export function startBunVmProcess(
	heapMiB: number,
	deliver: (message: VmMessage) => void,
	fail: (error?: Error) => void,
) {
	const runner = import.meta.url.endsWith(".ts")
		? new URL("./bun-runner.ts", import.meta.url)
		: new URL("./bun-runner.js", import.meta.url);
	const memoryMiB = heapMiB + VM_BUN_PROCESS_OVERHEAD_MIB;
	const linux = process.platform === "linux";
	const config = fileURLToPath(
		new URL("../../../src/tools/vm-mode/bunfig.toml", import.meta.url),
	);
	const bunArgs = ["--no-env-file", `--config=${config}`, "run"];
	// Scope mode execs the interpreter in the same PID, preserving fork IPC
	// and letting us kill the capped process without a separate systemctl call.
	const child = fork(
		fileURLToPath(runner),
		[String(memoryMiB), linux ? "cgroup" : "watchdog"],
		{
			cwd: fileURLToPath(new URL(".", runner)),
			execPath: linux ? "systemd-run" : process.execPath,
			execArgv: linux
				? [
						"--user",
						"--scope",
						"--quiet",
						"--collect",
						`--property=MemoryMax=${memoryMiB}M`,
						"--property=MemorySwapMax=0",
						"--",
						process.execPath,
						...bunArgs,
					]
				: bunArgs,
			env: { ...process.env, BUN_BE_BUN: "1", BUN_OPTIONS: "" },
			serialization: "json",
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			windowsHide: true,
		},
	);
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
		child.once("close", (code, signal) => {
			closed = true;
			fail(
				code === VM_BUN_WATCHDOG_EXIT && !stopping
					? new Error(MEMORY_LIMIT)
					: !ready
						? new Error(
								linux
									? `VM Code could not start a memory-limited Bun process. Requires full Bun, a systemd user session and cgroup v2. ${NEXT_STEP}`
									: `VM Code could not start its Bun process. Use a full Bun build. ${NEXT_STEP}`,
								{ cause: fault },
							)
						: linux && signal === "SIGKILL" && !stopping && !fault
							? new Error(
									"VM Code killed, possibly by its process memory limit. Conversation bindings dropped. Next exec starts fresh.",
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
