import type { WorkerDisposition } from "./types.js";

export function parseWorkerDisposition(text: string): WorkerDisposition {
	const finalLine = text
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (finalLine === "[complete]") return { status: "complete" };
	if (finalLine?.startsWith("[blocker]")) {
		const reason = finalLine.slice("[blocker]".length).trim();
		if (reason) return { status: "blocked", reason };
	}
	return { status: "incomplete" };
}
