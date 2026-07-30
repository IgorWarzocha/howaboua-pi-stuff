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

test("late empty polls replay a completed process result", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 1 });
	try {
		const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setTimeout(() => process.stdout.write('final output' + 'x'.repeat(400)), 500)")}`;
		const started = await sessions.exec({ cmd: command, yield_time_ms: 1, max_yield_time_ms: 1, login: false }, process.cwd());
		assert.equal(started.session_id, 1);

		const completed = await sessions.write({ session_id: 1, yield_time_ms: 1_000, max_output_tokens: 1 });
		assert.equal(completed.exit_code, 0);
		assert.equal(completed.output.length, 256);
		const fullReplay = await sessions.write({ session_id: 1 });
		assert.equal(fullReplay.exit_code, 0);
		assert.match(fullReplay.output, /final output/);
		assert.ok(fullReplay.output.length > completed.output.length);
		const cappedReplay = await sessions.write({ session_id: 1, max_output_tokens: 1 });
		assert.deepEqual(cappedReplay, completed);
		await assert.rejects(sessions.write({ session_id: 1, chars: "x" }));

		const largeCommand = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setTimeout(() => process.stdout.write('large head' + 'x'.repeat(70000) + 'large tail'), 500)")}`;
		const largeStarted = await sessions.exec({ cmd: largeCommand, yield_time_ms: 1, max_yield_time_ms: 1, login: false }, process.cwd());
		assert.equal(largeStarted.session_id, 2);
		const largeCompleted = await sessions.write({ session_id: 2, yield_time_ms: 1_000, max_output_tokens: Number.MAX_SAFE_INTEGER });
		assert.match(largeCompleted.output, /^large head/);
		assert.match(largeCompleted.output, /large tail$/);
		assert.ok(largeCompleted.output.length > 64 * 1024);
		const boundedReplay = await sessions.write({ session_id: 2, max_output_tokens: Number.MAX_SAFE_INTEGER });
		assert.equal(boundedReplay.output.length, 64 * 1024);
		assert.match(boundedReplay.output, /large tail$/);
	} finally {
		sessions.shutdown();
	}
});

test("unfinished empty polls keep growing their host wait despite output", async () => {
	const sessions = createExecSessionManager({
		minNonInteractiveExecYieldTimeMs: 250,
		minEmptyWriteYieldTimeMs: 250,
		maxEmptyWriteYieldTimeMs: 2_000,
	});
	try {
		const script = "const timer=setInterval(()=>process.stdout.write('.'),25);setTimeout(()=>{clearInterval(timer);process.exit(0)},4000)";
		const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
		const started = await sessions.exec({ cmd: command, yield_time_ms: 250, max_yield_time_ms: 250, login: false }, process.cwd());
		assert.equal(started.session_id, 1);

		const first = await sessions.write({ session_id: 1, yield_time_ms: 250 });
		assert.equal(first.session_id, 1);
		assert.ok(first.wall_time_seconds >= 0.4 && first.wall_time_seconds < 1);

		const second = await sessions.write({ session_id: 1, yield_time_ms: 250 });
		assert.equal(second.session_id, 1);
		assert.ok(second.wall_time_seconds >= 0.8 && second.wall_time_seconds < 1.5);
	} finally {
		sessions.shutdown();
	}
});

test("sessions finish after the shell exits when a detached child retains stdio", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 250 });
	let childId: number | undefined;
	try {
		const script = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});console.log('child-id:'+child.pid);child.unref()";
		const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
		const completed = await sessions.exec({ cmd: command, yield_time_ms: 1_500, max_yield_time_ms: 1_500, login: false }, process.cwd());
		childId = Number.parseInt(/child-id:(\d+)/.exec(completed.output)?.[1] ?? "", 10);
		assert.ok(Number.isFinite(childId));
		assert.equal(completed.exit_code, 0);
		assert.equal(completed.session_id, undefined);
		assert.equal(processIsRunning(childId), true);
	} finally {
		sessions.shutdown();
		if (childId !== undefined && processIsRunning(childId)) process.kill(childId);
	}
});
