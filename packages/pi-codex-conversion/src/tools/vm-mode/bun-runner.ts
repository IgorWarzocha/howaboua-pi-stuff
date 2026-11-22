import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { VmCommand, VmMessage, VmProcessMessage } from "./protocol.ts";

// Verify enforcement before loading the evaluator. Setting MemoryMax alone
// does not prove the user session actually has the v2 memory controller.
const expected = Number(process.argv[2]) * 1024 * 1024;
const cgroup = readFileSync("/proc/self/cgroup", "utf8")
	.split("\n")
	.find((line) => line.startsWith("0::/"))
	?.slice(3);
if (
	!cgroup ||
	!Number.isSafeInteger(expected) ||
	expected <= 0 ||
	Number(readFileSync(join("/sys/fs/cgroup", cgroup, "memory.max"), "utf8")) !==
		expected ||
	readFileSync(
		join("/sys/fs/cgroup", cgroup, "memory.swap.max"),
		"utf8",
	).trim() !== "0"
)
	throw new Error("VM Code process memory limit is not enforced");

if (!process.connected || !process.send) process.exit(1);
const entry = import.meta.url.endsWith(".ts")
	? new URL("./worker.ts", import.meta.url)
	: new URL("./worker.js", import.meta.url);
const worker = new Worker(entry);
function send(message: VmProcessMessage): void {
	process.send?.(message, (error) => {
		if (error) process.exit(1);
	});
}
// This thread stays available to handle parent loss even in a stalled cell.
process.on("disconnect", () => process.exit());
process.on("message", (command: VmCommand) => worker.postMessage(command));
worker.on("message", (message: VmMessage) => send(message));
worker.once("error", () => process.exit(1));
worker.once("exit", () => process.exit(1));
send({ kind: "ready" });
