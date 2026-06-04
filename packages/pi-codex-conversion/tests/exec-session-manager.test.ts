import test from "node:test";
import assert from "node:assert/strict";
import { createExecSessionManager, type UnifiedExecResult } from "../src/tools/exec-session-manager.ts";

function createFastTestExecSessionManager() {
	return createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 50, minEmptyWriteYieldTimeMs: 50, maxSessionBufferChars: 4096 });
}

async function finishSession(
	_sessionId: number,
	write: (chars?: string) => Promise<UnifiedExecResult>,
): Promise<{ output: string; final: UnifiedExecResult }> {
	let result = await write("hello\n");
	let output = result.output;
	for (let attempt = 0; attempt < 5 && result.session_id !== undefined; attempt++) {
		result = await write();
		output += result.output;
	}
	return { output, final: result };
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
				yield_time_ms: 50,
			}),
		);

		assert.equal(resumed.output, "hello\n:hello");
		assert.equal(resumed.final.session_id, undefined);
		assert.equal(resumed.final.exit_code, 0);
	} finally {
		sessions.shutdown();
	}
});

test("exec_command returns completed for short-lived commands that print before exiting", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const result = await sessions.exec(
			{
				cmd: "printf ready && sleep 0.05 && printf done",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 500,
			},
			process.cwd(),
		);

		assert.equal(result.output, "readydone");
		assert.equal(result.exit_code, 0);
		assert.equal(result.session_id, undefined);
	} finally {
		sessions.shutdown();
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

test("exec session manager coerces fish defaults to bash", async () => {
	const originalShell = process.env["SHELL"]!;
	process.env["SHELL"] = "/usr/bin/fish";
	const sessions = createFastTestExecSessionManager();
	try {
		const result = await sessions.exec(
			{
				cmd: "printf '%s' \"${BASH_VERSION:+bash}\"",
				login: false,
				yield_time_ms: 500,
			},
			process.cwd(),
		);

		assert.equal(result.output, "bash");
		assert.equal(result.exit_code, 0);
	} finally {
		sessions.shutdown();
		if (originalShell === undefined) {
			delete process.env["SHELL"];
		} else {
			process.env["SHELL"] = originalShell;
		}
	}
});

test("exec session manager coerces explicit fish shells to bash", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const result = await sessions.exec(
			{
				cmd: "printf '%s' \"${BASH_VERSION:+bash}\"",
				shell: "/usr/bin/fish",
				login: false,
				yield_time_ms: 500,
			},
			process.cwd(),
		);

		assert.equal(result.output, "bash");
		assert.equal(result.exit_code, 0);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager preserves fish-derived PATH and SHELL when forcing bash", async () => {
	const originalShell = process.env["SHELL"]!;
	const originalPath = process.env["PATH"]!;
	process.env["SHELL"] = "/usr/bin/fish";
	process.env["PATH"] = "/tmp/pi-codex-fish-path:/usr/bin:/bin";
	const sessions = createFastTestExecSessionManager();
	try {
		const result = await sessions.exec(
			{
				cmd: "printf 'PATH=%s\nSHELL=%s' \"$PATH\" \"$SHELL\"",
				yield_time_ms: 500,
			},
			process.cwd(),
		);

		assert.equal(result.output, "PATH=/tmp/pi-codex-fish-path:/usr/bin:/bin\nSHELL=/bin/bash");
		assert.equal(result.exit_code, 0);
	} finally {
		sessions.shutdown();
		if (originalShell === undefined) {
			delete process.env["SHELL"];
		} else {
			process.env["SHELL"] = originalShell;
		}
		if (originalPath === undefined) {
			delete process.env["PATH"];
		} else {
			process.env["PATH"] = originalPath;
		}
	}
});

test("write_stdin returns completed when interactive input causes a quick exit", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const started = await sessions.exec(
			{
				cmd: "read line && printf ':%s' \"$line\"",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");

		const resumed = await sessions.write({
			session_id: started.session_id!,
			chars: "hello\n",
			yield_time_ms: 500,
		});

		assert.equal(resumed.output, "hello\n:hello");
		assert.equal(resumed.exit_code, 0);
		assert.equal(resumed.session_id, undefined);
	} finally {
		sessions.shutdown();
	}
});

test("write_stdin partial updates do not replay already consumed output", async () => {
	const sessions = createFastTestExecSessionManager();
	const updates: UnifiedExecResult[] = [];
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
		const resumed = await sessions.write(
			{
				session_id: started.session_id!,
				chars: "hello\n",
				yield_time_ms: 500,
			},
			undefined,
			(update) => updates.push(update),
		);

		assert.ok(updates.length > 0);
		assert.ok(updates.every((update) => !update.output.includes("ready")));
		assert.equal(resumed.output, "hello\n:hello");
	} finally {
		sessions.shutdown();
	}
});

test("non-tty exec_command calls clamp tiny waits to the configured minimum", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 500, minEmptyWriteYieldTimeMs: 50 });
	try {
		const start = Date.now();
		const result = await sessions.exec(
			{
				cmd: "sleep 2",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 50,
			},
			process.cwd(),
		);
		const elapsed = Date.now() - start;

		assert.ok(elapsed >= 450, `expected non-interactive exec clamp >= 450ms, got ${elapsed}ms`);
		assert.equal(typeof result.session_id, "number");
	} finally {
		sessions.shutdown();
	}
});

test("tty exec_command calls stay responsive and do not use the non-interactive minimum", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 500, minEmptyWriteYieldTimeMs: 50 });
	try {
		const start = Date.now();
		const result = await sessions.exec(
			{
				cmd: "printf ready && read line",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);
		const elapsed = Date.now() - start;

		assert.ok(elapsed < 450, `expected interactive exec to stay responsive, got ${elapsed}ms`);
		assert.equal(result.output, "ready");
		assert.equal(typeof result.session_id, "number");
	} finally {
		sessions.shutdown();
	}
});

test("empty write_stdin polls are clamped to the configured minimum", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 50, minEmptyWriteYieldTimeMs: 500 });
	try {
		const started = await sessions.exec(
			{
				cmd: "sleep 2",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");

		const start = Date.now();
		const resumed = await sessions.write({
			session_id: started.session_id!,
			yield_time_ms: 50,
		});
		const elapsed = Date.now() - start;

		assert.ok(elapsed >= 450, `expected empty poll clamp >= 450ms, got ${elapsed}ms`);
		assert.equal(resumed.session_id, started.session_id);
	} finally {
		sessions.shutdown();
	}
});

test("empty write_stdin polls can wait beyond the normal 30s exec cap", async () => {
	const sessions = createExecSessionManager({
		minNonInteractiveExecYieldTimeMs: 50,
		minEmptyWriteYieldTimeMs: 50,
		maxEmptyWriteYieldTimeMs: 250,
	});
	try {
		const started = await sessions.exec(
			{
				cmd: "sleep 2",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");

		const start = Date.now();
		const resumed = await sessions.write({
			session_id: started.session_id!,
			yield_time_ms: 1_000,
		});
		const elapsed = Date.now() - start;

		assert.ok(elapsed >= 200, `expected empty poll to use dedicated max, got ${elapsed}ms`);
		assert.ok(elapsed < 800, `expected empty poll to cap before requested 1000ms, got ${elapsed}ms`);
		assert.equal(resumed.session_id, started.session_id);
	} finally {
		sessions.shutdown();
	}
});

test("empty write_stdin polls return promptly when aborted", async () => {
	const sessions = createExecSessionManager({
		minNonInteractiveExecYieldTimeMs: 50,
		minEmptyWriteYieldTimeMs: 50,
		maxEmptyWriteYieldTimeMs: 5_000,
	});
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

		const controller = new AbortController();
		setTimeout(() => controller.abort(), 100);
		const start = Date.now();
		const resumed = await sessions.write(
			{
				session_id: started.session_id!,
				yield_time_ms: 5_000,
			},
			controller.signal,
		);
		const elapsed = Date.now() - start;

		assert.ok(elapsed < 1_000, `expected abort to interrupt empty poll, got ${elapsed}ms`);
		assert.equal(resumed.session_id, started.session_id);
	} finally {
		sessions.shutdown();
	}
});

test("write_stdin does not write input when already aborted", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		const started = await sessions.exec(
			{
				cmd: "read line && printf ':%s' \"$line\"",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");
		const controller = new AbortController();
		controller.abort();

		await assert.rejects(
			() =>
				sessions.write(
					{
						session_id: started.session_id!,
						chars: "cancelled\n",
						yield_time_ms: 50,
					},
					controller.signal,
				),
			/write_stdin aborted/,
		);

		const resumed = await sessions.write({
			session_id: started.session_id!,
			chars: "hello\n",
			yield_time_ms: 500,
		});

		assert.equal(resumed.output, "hello\n:hello");
		assert.equal(resumed.exit_code, 0);
	} finally {
		sessions.shutdown();
	}
});

test("non-empty write_stdin calls stay responsive and do not use the empty-poll minimum", async () => {
	const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 50, minEmptyWriteYieldTimeMs: 500 });
	try {
		const started = await sessions.exec(
			{
				cmd: "read line && sleep 0.1 && printf ':%s' \"$line\"",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		assert.equal(typeof started.session_id, "number");

		const start = Date.now();
		const resumed = await sessions.write({
			session_id: started.session_id!,
			chars: "hello\n",
			yield_time_ms: 50,
		});
		const elapsed = Date.now() - start;

		assert.ok(elapsed < 450, `expected non-empty write to stay responsive, got ${elapsed}ms`);
		assert.equal(resumed.exit_code, 0);
		assert.equal(resumed.output, "hello\n:hello");
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

test("write_stdin rejects missing sessions", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		await assert.rejects(() => sessions.write({ session_id: 99999 }), /Unknown process id 99999/);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager caps buffered output to the configured maximum", async () => {
	const sessions = createExecSessionManager({ maxSessionBufferChars: 1024, minNonInteractiveExecYieldTimeMs: 50, minEmptyWriteYieldTimeMs: 50 });
	try {
		const result = await sessions.exec(
			{
				cmd: "node -e \"process.stdout.write('a'.repeat(2000))\"",
				shell: "/bin/bash",
				login: false,
				yield_time_ms: 500,
			},
			process.cwd(),
		);

		assert.equal(result.exit_code, 0);
		assert.equal(result.output.length, 1024);
		assert.equal(result.output, "a".repeat(1024));
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager strips terminal control noise from PTY output", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		let result = await sessions.exec(
			{
				cmd: "printf '\\033]11;rgb:0000/0000/0000\\007\\033[?2004hready\\001'",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		let output = result.output;
		for (let attempt = 0; attempt < 5 && result.session_id !== undefined; attempt++) {
			result = await sessions.write({ session_id: result.session_id, yield_time_ms: 50 });
			output += result.output;
		}

		assert.equal(output, "ready");
		assert.equal(result.exit_code, 0);
		assert.equal(result.session_id, undefined);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager strips non-CSI escape sequences from PTY output", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		let result = await sessions.exec(
			{
				cmd: "printf '\\033(Bok\\n'",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		let output = result.output;
		for (let attempt = 0; attempt < 5 && result.session_id !== undefined; attempt++) {
			result = await sessions.write({ session_id: result.session_id, yield_time_ms: 50 });
			output += result.output;
		}

		assert.equal(output, "ok\n");
		assert.equal(result.exit_code, 0);
		assert.equal(result.session_id, undefined);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager applies basic PTY cursor semantics for carriage returns and backspaces", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		let result = await sessions.exec(
			{
				cmd: "printf 'foo\\rbar\\nabc\\b\\bde\\n'",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		let output = result.output;
		for (let attempt = 0; attempt < 5 && result.session_id !== undefined; attempt++) {
			result = await sessions.write({ session_id: result.session_id, yield_time_ms: 50 });
			output += result.output;
		}

		assert.equal(output, "bar\nade\n");
		assert.equal(result.exit_code, 0);
		assert.equal(result.session_id, undefined);
	} finally {
		sessions.shutdown();
	}
});

test("exec session manager replays PTY line rewrites correctly across multiple polls", async () => {
	const sessions = createFastTestExecSessionManager();
	try {
		let result = await sessions.exec(
			{
				cmd: "printf foo; sleep 0.3; printf '\\r\\033[Kbar'; sleep 0.3; printf '\\n'",
				shell: "/bin/bash",
				login: false,
				tty: true,
				yield_time_ms: 50,
			},
			process.cwd(),
		);

		let replay = result.output;
		for (let attempt = 0; attempt < 8 && result.session_id !== undefined; attempt++) {
			result = await sessions.write({ session_id: result.session_id, yield_time_ms: 100 });
			replay += result.output;
		}

		assert.equal(replay, "foo\rbar\n");
		assert.equal(result.exit_code, 0);
		assert.equal(result.session_id, undefined);
	} finally {
		sessions.shutdown();
	}
});
