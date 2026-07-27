import assert from "node:assert/strict";
import test from "node:test";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";
import { waitForExitOrInactivity, type WaitableSession } from "../src/tools/exec/wait.ts";

function emitOutput(session: WaitableSession): void {
	session.outputVersion += 1;
	for (const listener of session.listeners) listener();
}

function runningSession(): WaitableSession {
	return { exitCode: undefined, outputVersion: 0, listeners: new Set() };
}

test("exec waits through output activity but yields on silence or the hard limit", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"] });

	const silent = runningSession();
	const silentWait = waitForExitOrInactivity(silent, 10, 30);
	t.mock.timers.tick(10);
	assert.equal(await silentWait, 10);

	const active = runningSession();
	const activeWait = waitForExitOrInactivity(active, 10, 30);
	for (let elapsed = 9; elapsed <= 27; elapsed += 9) {
		t.mock.timers.tick(9);
		emitOutput(active);
	}
	t.mock.timers.tick(3);
	assert.equal(await activeWait, 30);
});

test("late empty polls replay a completed process result", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 1 });
	try {
		const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setTimeout(() => process.stdout.write('final output'), 500)")}`;
		const started = await sessions.exec({ cmd: command, yield_time_ms: 1, max_yield_time_ms: 1, login: false }, process.cwd());
		assert.equal(started.session_id, 1);

		const completed = await sessions.write({ session_id: 1, yield_time_ms: 1_000 });
		assert.equal(completed.exit_code, 0);
		assert.match(completed.output, /final output/);
		assert.deepEqual(await sessions.write({ session_id: 1 }), completed);
		await assert.rejects(
			sessions.write({ session_id: 1, chars: "x" }),
			/Process id 1 already exited with code 0; cannot write stdin/,
		);
	} finally {
		sessions.shutdown();
	}
});
