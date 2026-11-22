import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { prepareCodeModeToolInput } from "../src/tools/code-mode/tool-input.ts";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "../src/tools/code-mode/types.ts";
import { vmHeapMiB, VM_HEAP_CAP_MIB } from "../src/tools/vm-mode/limits.ts";
import { VmCodeClient } from "../src/tools/vm-mode/client.ts";

function session(
	id: string,
	preflight?: ToolExecutionContext["preflight"],
): ToolExecutionContext {
	return {
		cwd: "/tmp/vm-code",
		toolCallId: "outer",
		extensionContext: {
			sessionManager: {
				getSessionId: () => id,
				getBranch: () => [],
			},
		} as unknown as ExtensionContext,
		...(preflight ? { preflight } : {}),
	};
}

function client(maxHeapMiB = 128): VmCodeClient {
	return new VmCodeClient({
		maxHeapMiB,
		agentDir: "/tmp/vm-code",
		prepareToolInput: prepareCodeModeToolInput,
	});
}

function textOf(response: RuntimeResponse): string {
	return response.contentItems
		.map((item) => (item.type === "input_text" ? item.text : ""))
		.join("\n");
}

test("heap cap clamps larger settings", () => {
	assert.equal(vmHeapMiB(4096), VM_HEAP_CAP_MIB);
	assert.equal(VM_HEAP_CAP_MIB, 256);
	assert.throws(() => vmHeapMiB(32), /at least 64/);
});

test("let bindings survive later execs and a script error", async () => {
	const code = client();
	try {
		await code.execute("let kept = 7", session("a"));
		const read = await code.execute("text(String(kept))", session("a"));
		assert.match(textOf(read), /7/);
		const redeclared = await code.execute("let kept = 8", session("a"));
		assert.match(
			redeclared.kind === "result" ? (redeclared.errorText ?? "") : "",
			/already been declared/,
		);
		const still = await code.execute("text(String(kept))", session("a"));
		assert.match(textOf(still), /7/);
		const failed = await code.execute(
			"kept = 9; throw new Error('no')",
			session("a"),
		);
		assert.match(
			failed.kind === "result" ? (failed.errorText ?? "") : "",
			/no/,
		);
		const after = await code.execute("text(String(kept))", session("a"));
		assert.match(textOf(after), /9/);
	} finally {
		await code.shutdown();
	}
});

test("store rejects an oversized value and keeps the context", async () => {
	const code = client();
	try {
		await code.execute("store('k', 'ok')", session("store"));
		const oversized = await code.execute(
			"store('big', 'x'.repeat(300000))",
			session("store"),
		);
		assert.match(
			oversized.kind === "result" ? (oversized.errorText ?? "") : "",
			/too large/,
		);
		const kept = await code.execute("text(load('k'))", session("store"));
		assert.match(textOf(kept), /ok/);
	} finally {
		await code.shutdown();
	}
});

test("tool calls use the delegate and preflight path", async () => {
	const seen: string[] = [];
	const echo: CodeModeToolDefinition = {
		name: "echo",
		usage: "tools.echo(value)",
		deferLoading: false,
		kind: "function",
		async invoke(input) {
			return input;
		},
	};
	const code = client();
	try {
		const result = await code.execute(
			"tools.echo({ text: 'pong' }).then(value => text(value.text))",
			session("tools", async (call) => {
				seen.push(call.toolName);
			}),
			undefined,
			[echo],
		);
		assert.deepEqual(seen, ["echo"]);
		assert.match(textOf(result), /pong/);
	} finally {
		await code.shutdown();
	}
});

test("a tight loop is stopped and the next exec starts fresh", async () => {
	const code = client();
	try {
		await code.execute("let kept = 1", session("stall"));
		const stalled = await code.execute(
			'// @exec: {"yield_time_ms": 200}\nwhile (true);',
			session("stall"),
		);
		assert.equal(stalled.kind, "result");
		assert.match(stalled.errorText ?? "", /dropped/);
		const fresh = await code.execute("text(typeof kept)", session("stall"));
		assert.match(textOf(fresh), /undefined/);
	} finally {
		await code.shutdown();
	}
});

test("abort stops a tight loop", async () => {
	const code = client();
	try {
		const signal = AbortSignal.timeout(200);
		try {
			const result = await code.execute(
				"while (true);",
				session("abort"),
				signal,
			);
			assert.match(
				result.kind === "result" ? (result.errorText ?? "") : "",
				/cancel|dropped|abort/i,
			);
		} catch (error) {
			assert.match(
				error instanceof Error ? error.message : String(error),
				/abort|cancel/i,
			);
		}
		const next = await code.execute("text(1)", session("abort"));
		assert.match(textOf(next), /1/);
	} finally {
		await code.shutdown();
	}
});

test("conversations do not share a context", async () => {
	const code = client();
	try {
		await code.execute("let kept = 1", session("one"));
		const other = await code.execute("text(typeof kept)", session("two"));
		assert.match(textOf(other), /undefined/);
	} finally {
		await code.shutdown();
	}
});

test("host process, require, import and string eval stay unavailable", async () => {
	const code = client();
	try {
		const imported = await code.execute("import('node:fs')", session("host"));
		assert.match(
			imported.kind === "result" ? (imported.errorText ?? "") : "",
			/import/i,
		);
		const awaited = await code.execute(
			"await import('node:fs')",
			session("host"),
		);
		assert.match(
			awaited.kind === "result" ? (awaited.errorText ?? "") : "",
			/import/i,
		);
		const kinds = await code.execute(
			"text(typeof process + ':' + typeof require)",
			session("host"),
		);
		assert.match(textOf(kinds), /undefined:undefined/);
		const generated = await code.execute(
			"Function('return process')()",
			session("host"),
		);
		assert.match(
			generated.kind === "result" ? (generated.errorText ?? "") : "",
			/code generation|disallowed/i,
		);
		const awaitedGenerated = await code.execute(
			"await Promise.resolve(); Function('return process')()",
			session("host"),
		);
		assert.match(
			awaitedGenerated.kind === "result"
				? (awaitedGenerated.errorText ?? "")
				: "",
			/code generation|disallowed/i,
		);
	} finally {
		await code.shutdown();
	}
});

test("top-level await keeps let, function and class bindings", async () => {
	const code = client();
	try {
		await code.execute("let kept = await Promise.resolve(7)", session("await"));
		const read = await code.execute("text(String(kept))", session("await"));
		assert.match(textOf(read), /7/);
		const redeclared = await code.execute(
			"let kept = await Promise.resolve(8)",
			session("await"),
		);
		assert.match(
			redeclared.kind === "result" ? (redeclared.errorText ?? "") : "",
			/already been declared/,
		);
		await code.execute(
			"function helper() { return 6 }\nclass Box { n() { return 5 } }\nawait Promise.resolve()",
			session("await"),
		);
		const defined = await code.execute(
			"text(String(helper() + new Box().n()))",
			session("await"),
		);
		assert.match(textOf(defined), /11/);
		const hidden = await code.execute(
			"{ let hidden = 1 }\nawait Promise.resolve()\ntext(typeof hidden)",
			session("await"),
		);
		assert.match(textOf(hidden), /undefined/);
		const assigned = await code.execute(
			"const fixed = await Promise.resolve(4)\nfixed = 9\ntext(fixed)",
			session("await"),
		);
		assert.match(
			assigned.kind === "result" ? (assigned.errorText ?? "") : "",
			/constant/,
		);
		const readFixed = await code.execute(
			"text(String(fixed))",
			session("await"),
		);
		assert.match(textOf(readFixed), /4/);
		const hoisted = await code.execute(
			"text(helper()); function helper() { return 6 }; await Promise.resolve()",
			session("await"),
		);
		assert.match(textOf(hoisted), /6/);
		await code.execute("var retained = 7", session("await"));
		const keptVar = await code.execute(
			"var retained; await Promise.resolve(); text(retained)",
			session("await"),
		);
		assert.match(textOf(keptVar), /7/);
		await code.execute(
			"if (true) { var fromBlock = 8 }; await Promise.resolve()",
			session("await"),
		);
		const fromBlock = await code.execute(
			"text(String(fromBlock))",
			session("await"),
		);
		assert.match(textOf(fromBlock), /8/);
		const plain = await code.execute(
			"const plain = 1\nplain = 2",
			session("await"),
		);
		assert.match(
			plain.kind === "result" ? (plain.errorText ?? "") : "",
			/constant/,
		);
		const stillPlain = await code.execute(
			"text(String(plain))",
			session("await"),
		);
		assert.match(textOf(stillPlain), /1/);
	} finally {
		await code.shutdown();
	}
});

test("awaited tool results stay ordered and a rejection keeps earlier bindings", async () => {
	const seen: string[] = [];
	const echo: CodeModeToolDefinition = {
		name: "echo",
		usage: "tools.echo(value)",
		deferLoading: false,
		kind: "function",
		async invoke(input) {
			return input;
		},
	};
	const code = client();
	try {
		const result = await code.execute(
			"let first = await tools.echo({ text: 'one' })\nlet second = await tools.echo({ text: first.text + 'two' })\ntext(second.text)",
			session("await-tools", async (call) => {
				seen.push(call.toolName);
			}),
			undefined,
			[echo],
		);
		assert.deepEqual(seen, ["echo", "echo"]);
		assert.match(textOf(result), /onetwo/);
		const rejected = await code.execute(
			"await Promise.reject(new Error('no'))",
			session("await-tools"),
		);
		assert.match(
			rejected.kind === "result" ? (rejected.errorText ?? "") : "",
			/no/,
		);
		const kept = await code.execute("text(first.text)", session("await-tools"));
		assert.match(textOf(kept), /one/);
		const thrown = await code.execute(
			"let after = 4\nthrow new Error('later')",
			session("await-tools"),
		);
		assert.match(
			thrown.kind === "result" ? (thrown.errorText ?? "") : "",
			/later/,
		);
		const after = await code.execute(
			"text(String(after))",
			session("await-tools"),
		);
		assert.match(textOf(after), /4/);
		const partial = await code.execute(
			"let first = 1, second = await Promise.reject(new Error('no'))\nfunction read() { return first }",
			session("await-partial"),
		);
		assert.match(
			partial.kind === "result" ? (partial.errorText ?? "") : "",
			/no/,
		);
		const keptPartial = await code.execute(
			"text(String(first))",
			session("await-partial"),
		);
		assert.equal(textOf(keptPartial), "1");
		const closed = await code.execute(
			"first = 5; text(String(read()))",
			session("await-partial"),
		);
		assert.equal(textOf(closed), "5");
		const redeclared = await code.execute(
			"let first = 3",
			session("await-partial"),
		);
		assert.match(
			redeclared.kind === "result" ? (redeclared.errorText ?? "") : "",
			/already been declared/,
		);
		const absent = await code.execute(
			"text(typeof second)",
			session("await-partial"),
		);
		assert.match(textOf(absent), /undefined/);
		const fail: CodeModeToolDefinition = {
			name: "fail",
			usage: "tools.fail()",
			deferLoading: false,
			kind: "function",
			async invoke() {
				throw new Error("no");
			},
		};
		const toolPartial = await code.execute(
			"let saved = await tools.echo({ text: 'kept' }), failed = await tools.fail()",
			session("await-partial-tool"),
			undefined,
			[echo, fail],
		);
		assert.match(
			toolPartial.kind === "result" ? (toolPartial.errorText ?? "") : "",
			/no/,
		);
		const saved = await code.execute(
			"text(saved.text)",
			session("await-partial-tool"),
		);
		assert.match(textOf(saved), /kept/);
		const fixedPartial = await code.execute(
			"const fixed = 4, failed = await Promise.reject(new Error('no'))",
			session("await-partial-const"),
		);
		assert.match(
			fixedPartial.kind === "result" ? (fixedPartial.errorText ?? "") : "",
			/no/,
		);
		const fixedRead = await code.execute(
			"text(String(fixed))",
			session("await-partial-const"),
		);
		assert.equal(textOf(fixedRead), "4");
		const assigned = await code.execute(
			"fixed = 9",
			session("await-partial-const"),
		);
		assert.match(
			assigned.kind === "result" ? (assigned.errorText ?? "") : "",
			/constant/,
		);
	} finally {
		await code.shutdown();
	}
});

test("cancellation during await drops the context", async () => {
	const code = client();
	try {
		await code.execute("let kept = 1", session("await-abort"));
		const signal = AbortSignal.timeout(200);
		try {
			const result = await code.execute(
				"await new Promise(() => {})",
				session("await-abort"),
				signal,
			);
			assert.match(
				result.kind === "result" ? (result.errorText ?? "") : "",
				/cancel|dropped|abort/i,
			);
		} catch (error) {
			assert.match(
				error instanceof Error ? error.message : String(error),
				/abort|cancel/i,
			);
		}
		const fresh = await code.execute(
			"text(typeof kept)",
			session("await-abort"),
		);
		assert.match(textOf(fresh), /undefined/);
	} finally {
		await code.shutdown();
	}
});

test("a failed cell drains tool callbacks before the next exec", async () => {
	const echo: CodeModeToolDefinition = {
		name: "echo",
		usage: "tools.echo(value)",
		deferLoading: false,
		kind: "function",
		async invoke(input) {
			await new Promise((resolve) => setTimeout(resolve, 30));
			return input;
		},
	};
	const code = client();
	try {
		const failed = await code.execute(
			"tools.echo(1).catch(() => { text('OLD CONTINUATION'); globalThis.leaked = 42 })\nthrow new Error('oops')",
			session("leak"),
			undefined,
			[echo],
		);
		assert.match(
			failed.kind === "result" ? (failed.errorText ?? "") : "",
			/oops/,
		);
		assert.match(textOf(failed), /OLD CONTINUATION/);
		const next = await code.execute(
			"text('NEW'); text(String(globalThis.leaked))",
			session("leak"),
		);
		assert.equal(textOf(next), "NEW\n42");
	} finally {
		await code.shutdown();
	}
});

test("awaited cells reject declaration conflicts before effects", async () => {
	let calls = 0;
	const echo: CodeModeToolDefinition = {
		name: "echo",
		usage: "tools.echo(value)",
		deferLoading: false,
		kind: "function",
		async invoke(input) {
			calls += 1;
			return input;
		},
	};
	const code = client();
	try {
		const dead = await code.execute(
			"text('before')\ntext(typeof later)\ntext('after')\nlet later = 1\nawait Promise.resolve()",
			session("declare"),
		);
		assert.match(
			dead.kind === "result" ? (dead.errorText ?? "") : "",
			/before initialization/,
		);
		assert.equal(textOf(dead), "before");
		const absent = await code.execute("text(typeof later)", session("declare"));
		assert.match(textOf(absent), /undefined/);
		const assigned = await code.execute(
			"later = 2\ntext('EFFECT')\nlet later = 1\nawait Promise.resolve()\ntext(later)",
			session("declare-assign"),
		);
		assert.match(
			assigned.kind === "result" ? (assigned.errorText ?? "") : "",
			/before initialization/,
		);
		assert.equal(textOf(assigned), "");
		await code.execute("const fixed = 1", session("declare"));
		const redeclared = await code.execute(
			"tools.echo(1); text('SHOULD NOT PRINT'); const fixed = 8; await Promise.resolve()",
			session("declare"),
			undefined,
			[echo],
		);
		assert.match(
			redeclared.kind === "result" ? (redeclared.errorText ?? "") : "",
			/already been declared/,
		);
		assert.equal(textOf(redeclared), "");
		assert.equal(calls, 0);
		const kept = await code.execute("text(String(fixed))", session("declare"));
		assert.match(textOf(kept), /1/);
	} finally {
		await code.shutdown();
	}
});

test("awaited closures share the bindings later cells read and write", async () => {
	const code = client();
	try {
		await code.execute(
			"let count = await Promise.resolve(0)\nfunction increment() { count++ }",
			session("closure"),
		);
		const up = await code.execute(
			"increment(); text(String(count))",
			session("closure"),
		);
		assert.equal(textOf(up), "1");
		await code.execute("count = 10", session("closure"));
		const again = await code.execute(
			"increment(); text(String(count))",
			session("closure"),
		);
		assert.equal(textOf(again), "11");
		await code.execute(
			"function add() { return total + 1 }\nlet total = await Promise.resolve(4)",
			session("closure-before"),
		);
		const shared = await code.execute(
			"total = 7; text(String(add()))",
			session("closure-before"),
		);
		assert.equal(textOf(shared), "8");
		await code.execute(
			"let other = 1\nconst bump = () => { other++ }\nclass Box { bump() { other++ } value() { return other } }\nawait Promise.resolve()",
			session("closure-sync"),
		);
		await code.execute(
			"bump(); new Box().bump(); other = 5",
			session("closure-sync"),
		);
		const boxed = await code.execute(
			"new Box().bump(); text(String(other))",
			session("closure-sync"),
		);
		assert.equal(textOf(boxed), "6");
		const caught = await code.execute(
			"try { await Promise.reject(new Error('no')) } catch (error) { text(error.message) }\nlet kept = 5",
			session("closure"),
		);
		assert.equal(textOf(caught), "no");
		const kept = await code.execute("text(String(kept))", session("closure"));
		assert.equal(textOf(kept), "5");
		await code.execute(
			"if (true) { var fromAwait = await Promise.resolve(8) }",
			session("closure"),
		);
		const fromAwait = await code.execute(
			"text(String(fromAwait))",
			session("closure"),
		);
		assert.equal(textOf(fromAwait), "8");
		const crossed = await code.execute(
			"text('before')\ntext(typeof future)\ntext('after')\nawait Promise.resolve()\nlet future = 1\nfunction getFuture() { return future }",
			session("closure-tdz"),
		);
		assert.match(
			crossed.kind === "result" ? (crossed.errorText ?? "") : "",
			/before initialization/,
		);
		assert.equal(textOf(crossed), "before");
		const futureAbsent = await code.execute(
			"text(typeof future)",
			session("closure-tdz"),
		);
		assert.match(textOf(futureAbsent), /undefined/);
		const ordered = await code.execute(
			"await Promise.resolve()\ntext('mid')\nlet future = (text('init'), 1)\nfunction getFuture() { return future }",
			session("closure-live"),
		);
		assert.equal(textOf(ordered), "mid\ninit");
		await code.execute("future = 4", session("closure-live"));
		const seen = await code.execute(
			"text(String(getFuture()))",
			session("closure-live"),
		);
		assert.equal(textOf(seen), "4");
	} finally {
		await code.shutdown();
	}
});

test("a script error cancels an outstanding tool instead of waiting for it", async () => {
	let aborted = false;
	const slow: CodeModeToolDefinition = {
		name: "slow",
		usage: "tools.slow()",
		deferLoading: false,
		kind: "function",
		invoke(_input, _context, signal) {
			return new Promise((_resolve, reject) => {
				const abort = () => {
					aborted = true;
					reject(new Error("aborted"));
				};
				if (signal.aborted) abort();
				else signal.addEventListener("abort", abort, { once: true });
			});
		},
	};
	const code = client();
	try {
		const started = Date.now();
		const failed = await code.execute(
			"tools.slow(); throw new Error('oops')",
			session("cancel-tool"),
			AbortSignal.timeout(1000),
			[slow],
		);
		assert.match(
			failed.kind === "result" ? (failed.errorText ?? "") : "",
			/oops/,
		);
		assert.ok(Date.now() - started < 800);
		assert.equal(aborted, true);
	} finally {
		await code.shutdown();
	}
});

test("memory limit drops the context and the next exec rebuilds it", async () => {
	const code = client(64);
	try {
		const failed = await code.execute(
			"const chunks = []; for (let i = 0; i < 80; i++) { const row = new Array(100000); for (let j = 0; j < row.length; j++) row[j] = { i, j }; chunks.push(row); }",
			session("oom"),
		);
		assert.match(
			failed.kind === "result" ? (failed.errorText ?? "") : "",
			/memory limit/,
		);
		const fresh = await code.execute("text(typeof chunks)", session("oom"));
		assert.match(textOf(fresh), /undefined/);
	} finally {
		await code.shutdown();
	}
});
