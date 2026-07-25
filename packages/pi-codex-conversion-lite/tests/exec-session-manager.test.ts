import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTerminalOutput, type ExecOutputSessionState } from "../src/tools/exec/output.ts";
import { createExecCommandTool } from "../src/tools/exec/command-tool.ts";
import { createExecCommandTracker } from "../src/tools/exec/command-state.ts";
import { createExecSessionManager, type UnifiedExecResult } from "../src/tools/exec/session-manager.ts";
import { DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS, clampExecYieldTime, clampWriteYieldTime, normalizeMinEmptyWriteYieldTime } from "../src/tools/exec/shell.ts";

function createFastTestExecSessionManager() {
	return createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 50, minEmptyWriteYieldTimeMs: 50, maxSessionBufferChars: 4096 });
}

test("shell wait policy permits long work and rejects impatient empty polling", () => {
	const emptyPollFloor = normalizeMinEmptyWriteYieldTime(undefined);

	assert.equal(emptyPollFloor, 30_000);
	assert.equal(clampExecYieldTime(600_000, 10_000, false, 5_000), 600_000);
	assert.equal(clampWriteYieldTime(600_000, 250, true, emptyPollFloor, DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS), 600_000);
});

test("exec_command keeps non-TTY foreground work attached without mutating model arguments", async () => {
	const sessions = createFastTestExecSessionManager();
	const tool = createExecCommandTool(createExecCommandTracker(), sessions);
	const args = { cmd: "sleep 0.6", shell: "/bin/bash", login: false, yield_time_ms: 1 };
	try {
		const result = await tool.execute("foreground", args, undefined, undefined, {
			cwd: process.cwd(),
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6" },
		} as never);

		assert.deepEqual(args, { cmd: "sleep 0.6", shell: "/bin/bash", login: false, yield_time_ms: 1 });
		assert.equal((result.details as UnifiedExecResult).exit_code, 0);
		assert.equal((result.details as UnifiedExecResult).session_id, undefined);
	} finally {
		sessions.shutdown();
	}
});

async function finishSession(
	_sessionId: number,
	write: (chars?: string) => Promise<UnifiedExecResult>,
): Promise<{ output: string; final: UnifiedExecResult }> {
	let result = await write("hello\n");
	let output = result.output;
	for (let attempt = 0; attempt < 20 && result.session_id !== undefined; attempt++) {
		result = await write();
		output += result.output;
	}
	return { output, final: result };
}

function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForPidExit(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (!isPidRunning(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isPidRunning(pid);
}

test("exec session manager supports long-running commands via write_stdin", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const started = await sessions.exec(
			{
				cmd: "printf ready && read line && printf ':%s' \"$line\"",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(started.output, "ready");
		assert.equal(typeof started.session_id, "number");
		assert.equal(started.exit_code, undefined);

		const resumed = await finishSession(started.session_id!, (chars) =>
			sessions.write({
				session_id: started.session_id!,
				chars,
				yield_time_ms: 100,
			}),
		);

		assert.equal(resumed.output, "hello\n:hello");
		assert.equal(resumed.final.session_id, undefined);
		assert.equal(resumed.final.exit_code, 0);
	} finally {
		sessions.shutdown();
	}
});

test("empty write_stdin polls inherit exponential session backoff", async () => {
	const sessions = createExecSessionManager({
		minNonInteractiveExecYieldTimeMs: 20,
		minEmptyWriteYieldTimeMs: 20,
		maxEmptyWriteYieldTimeMs: 200,
	});
	try {
		const started = await sessions.exec(
			{ cmd: "sleep 3", shell: "/bin/bash", login: false, yield_time_ms: 20 },
			process.cwd(),
		);
		const first = await sessions.write({ session_id: started.session_id!, yield_time_ms: 20 });
		const second = await sessions.write({ session_id: started.session_id!, yield_time_ms: 20 });

		assert.equal(typeof second.session_id, "number");
		assert.ok(first.wall_time_seconds >= 0.03, `first poll waited ${first.wall_time_seconds}s`);
		assert.ok(second.wall_time_seconds >= 0.07, `second poll waited ${second.wall_time_seconds}s`);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager can terminate running sessions", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const started = await sessions.exec(
			{
				cmd: "sleep 5",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");
		assert.equal(sessions.terminateSession(started.session_id!), true);
		assert.equal(sessions.listSessions().length, 1);
		assert.equal(sessions.listSessions()[0]!.terminating, true);
		assert.equal(sessions.terminateSession(started.session_id!), false);

		const finished = await sessions.write({ session_id: started.session_id!, yield_time_ms: 500 });
		assert.equal(finished.session_id, undefined);
		assert.notEqual(finished.exit_code, 0);
		assert.equal(sessions.listSessions().length, 0);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager terminates child processes for non-tty sessions", { skip: process.platform === "win32" }, async () => {
	const sessions = createFastTestExecSessionManager();
	const dir = mkdtempSync(join(tmpdir(), "pi-codex-session-"));
	const pidFile = join(dir, "child.pid");
	let childPid: number | undefined;
	try {
		const childScript = "setInterval(() => {}, 1000)";
		const parentScript = `const { spawn } = require("node:child_process"); const fs = require("node:fs"); const child = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" }); fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000);`;
		const started = await sessions.exec(
			{
				cmd: `${process.execPath} -e ${JSON.stringify(parentScript)}`,
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");
		for (let attempt = 0; attempt < 10 && !existsSync(pidFile); attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		childPid = Number(readFileSync(pidFile, "utf-8"));
		assert.equal(isPidRunning(childPid), true);

		assert.equal(sessions.terminateSession(started.session_id!), true);
		await sessions.write({ session_id: started.session_id!, yield_time_ms: 500 });
		assert.equal(await waitForPidExit(childPid), true);
	} finally {
		if (childPid && isPidRunning(childPid)) process.kill(childPid, "SIGKILL");
		sessions.shutdown();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("exec_command emits partial execution updates without consuming final output", async () => {
	const sessions = createFastTestExecSessionManager();
	const updates: UnifiedExecResult[] = [];
	try {
		const result = await sessions.exec(
			{
				cmd: "printf ready && sleep 0.05 && printf done",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 500,
			},
			process.cwd(),
			undefined,
			(update) => updates.push(update),
		);

		assert.ok(updates.some((update) => update.output.includes("ready")));
		assert.equal(result.output, "readydone");
		assert.equal(result.exit_code, 0);
	} finally {
		sessions.shutdown();
	}
});

test("write_stdin rejects interactive input for non-tty sessions", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const started = await sessions.exec(
			{
				cmd: "sleep 5",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");
		await assert.rejects(
			() =>
				sessions.write({
					session_id: started.session_id!,
					chars: "hello\n",
					yield_time_ms: 50,
				}),
			/stdin is closed for this session/i,
		);
	} finally {
		sessions.shutdown();
	}
});

test("terminal output strips control noise", () => {
	const session: ExecOutputSessionState = {
		buffer: "",
		emittedBuffer: "",
		tty: true,
		terminalCommitted: "",
		terminalLine: [],
		terminalCursor: 0,
	};

	assert.equal(applyTerminalOutput(session, "\u001b]11;rgb:0000/0000/0000\u0007\u001b[?2004hready\u0001"), "ready");
});
