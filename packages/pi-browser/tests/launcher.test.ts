import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "../src/browser/launcher.js";
import { runProgram } from "../src/browser/remote-process.js";

test("browser child processes preserve cancellation and UTF-8 output", {
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
	const utf8 = await runProgram(
		process.execPath,
		[
			"-e",
			"const b=Buffer.from('A🤣B');process.stdout.write(b.subarray(0,3));setTimeout(()=>process.stdout.end(b.subarray(3)),25)",
		],
		undefined,
	);
	assert.equal(utf8.code, 0);
	assert.equal(utf8.stdout, "A🤣B");
});
