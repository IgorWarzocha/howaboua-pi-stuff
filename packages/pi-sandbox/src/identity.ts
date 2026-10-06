import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export async function processIdentity(pid: number) {
	if (process.platform === "linux") {
		const boot = (
			await readFile("/proc/sys/kernel/random/boot_id", "utf8")
		).trim();
		const stat = await readFile(`/proc/${pid}/stat`, "utf8");
		return {
			pid,
			start: `${boot}:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`,
		};
	}
	const start = execFileSync(
		"ps",
		["-p", String(pid), "-o", "lstart=", "-o", "args="],
		{ encoding: "utf8", timeout: 3000 },
	).trim();
	return { pid, start };
}
