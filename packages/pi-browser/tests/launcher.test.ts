import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "../src/browser/launcher.js";

test("browser child cancellation escalates when SIGTERM is ignored", {
	timeout: 4_000,
}, async () => {
	const controller = new AbortController();
	const running = runProcess(
		process.execPath,
		["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
		controller.signal,
	);
	await new Promise((resolveValue) => setTimeout(resolveValue, 100));
	controller.abort(new Error("cancelled by caller"));
	await assert.rejects(running, /cancelled by caller/);
});
