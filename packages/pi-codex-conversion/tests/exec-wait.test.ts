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

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
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

test("sessions stay owned until exit when requested and ignore detached inherited stdio", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 250 });
	let childId: number | undefined;
	try {
		const delayed = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setTimeout(() => {}, 750)")}`;
		const awaited = await sessions.exec(
			{
				cmd: delayed,
				yield_time_ms: 250,
				max_yield_time_ms: 250,
				wait_until_exit: true,
				login: false,
			},
			process.cwd(),
		);
		assert.equal(awaited.exit_code, 0);
		assert.equal(awaited.session_id, undefined);

		const script = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});console.log('child-id:'+child.pid);child.unref()";
		const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
		const completed = await sessions.exec({ cmd: command, yield_time_ms: 1_500, max_yield_time_ms: 1_500, login: false }, process.cwd());
		childId = Number.parseInt(/child-id:(\d+)/.exec(completed.output)?.[1] ?? "", 10);
		assert.ok(Number.isFinite(childId));
		assert.equal(completed.exit_code, 0);
		assert.equal(completed.session_id, undefined);
		assert.equal(processIsRunning(childId), true);
	} finally {
		await sessions.shutdown();
		if (childId !== undefined && processIsRunning(childId)) process.kill(childId);
	}
});
