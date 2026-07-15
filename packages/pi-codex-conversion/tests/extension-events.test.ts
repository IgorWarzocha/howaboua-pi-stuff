import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { prepareCodeModeHost, registerCodexEvents } from "../src/extension/events.ts";

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

test("session shutdown scopes transport cleanup to the current session", async () => {
	const handlers = new Map<string, (...args: never[]) => unknown>();
	const shutdownSessionIds: string[] = [];
	const pi = {
		on(event: string, handler: (...args: never[]) => unknown) {
			handlers.set(event, handler);
		},
	};
	const runtime = {
		state: {},
		tracker: { recordSessionFinished() {} },
		sessions: { onSessionExit() {}, shutdown() {} },
		backgroundWidget: { ctx: {} },
		shutdownTransport(sessionId: string) {
			shutdownSessionIds.push(sessionId);
		},
	};

	registerCodexEvents(
		pi as never,
		runtime as never,
		{} as never,
		{ clearBackgroundWidget() {} } as never,
		{ shutdown: async () => {} } as never,
		{ shutdown() {} } as never,
	);

	const shutdown = handlers.get("session_shutdown");
	assert.ok(shutdown);
	await shutdown({ type: "session_shutdown", reason: "quit" } as never, {
		sessionManager: { getSessionId: () => "child-a" },
	} as never);

	assert.deepEqual(shutdownSessionIds, ["child-a"]);
});
