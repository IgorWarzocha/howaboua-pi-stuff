import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { prepareCodeModeHost } from "../src/extension/events.ts";

test("Code Mode host setup cancellation stays silent", async () => {
	const notifications: string[] = [];
	const abort = new Error("The operation was aborted");
	abort.name = "AbortError";
	prepareCodeModeHost({
		prepare: () => Promise.reject(abort),
	} as never, {
		ui: { notify: (message: string) => notifications.push(message) },
	} as never);

	await flush();
	assert.deepEqual(notifications, []);
});

test("Code Mode reports real host setup failures", async () => {
	const notifications: string[] = [];
	prepareCodeModeHost({
		prepare: () => Promise.reject(new Error("download failed")),
	} as never, {
		ui: { notify: (message: string) => notifications.push(message) },
	} as never);

	await flush();
	assert.deepEqual(notifications, ["Code Mode host setup failed: download failed"]);
});
