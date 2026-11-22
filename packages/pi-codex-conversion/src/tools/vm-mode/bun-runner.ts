import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { VM_BUN_WATCHDOG_EXIT } from "./limits.ts";
import type { VmCommand, VmMessage, VmProcessMessage } from "./protocol.ts";

function verifyCgroup(budget: number): void {
	// Setting MemoryMax alone does not prove the session has the controller.
	const cgroup = readFileSync("/proc/self/cgroup", "utf8")
		.split("\n")
		.find((line) => line.startsWith("0::/"))
		?.slice(3);
	if (
		!cgroup ||
		Number(
			readFileSync(join("/sys/fs/cgroup", cgroup, "memory.max"), "utf8"),
		) !== budget ||
		readFileSync(
			join("/sys/fs/cgroup", cgroup, "memory.swap.max"),
			"utf8",
		).trim() !== "0"
	)
		throw new Error("VM Code process memory limit is not enforced");
}

function watchMemory(budget: number): () => void {
	const check = () => {
		const rss = process.memoryUsage.rss();
		if (!Number.isSafeInteger(rss) || rss <= 0)
			throw new Error("VM Code process memory cannot be measured");
		if (rss > budget) process.exit(VM_BUN_WATCHDOG_EXIT);
	};
	check();
	// The evaluator is on another thread; synchronous cells cannot block this timer.
	setInterval(check, 20).unref();
	return check;
}

const budget = Number(process.argv[2]) * 1024 * 1024;
const policy = process.argv[3];
if (!Number.isSafeInteger(budget) || budget <= 0)
	throw new Error("VM Code process memory budget is invalid");
let checkMemory: (() => void) | undefined;
if (policy === "cgroup") verifyCgroup(budget);
else if (policy === "watchdog") checkMemory = watchMemory(budget);
else throw new Error("VM Code process memory policy is missing");

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
worker.on("message", (message: VmMessage) => {
	checkMemory?.();
	send(message);
});
worker.once("error", () => process.exit(1));
worker.once("exit", () => process.exit(1));
send({ kind: "ready" });
