import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { prepareCodeModeToolInput } from "../src/tools/code-mode/tool-input.ts";
import type { CodeModeToolDefinition, RuntimeResponse, ToolExecutionContext } from "../src/tools/code-mode/types.ts";
import { vmHeapMiB, VM_HEAP_CAP_MIB } from "../src/tools/vm-mode/limits.ts";
import { VmCodeClient } from "../src/tools/vm-mode/client.ts";

function session(id: string, preflight?: ToolExecutionContext["preflight"]): ToolExecutionContext {
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
	return new VmCodeClient({ maxHeapMiB, agentDir: "/tmp/vm-code", prepareToolInput: prepareCodeModeToolInput });
}

function textOf(response: RuntimeResponse): string {
	return response.contentItems.map(item => item.type === "input_text" ? item.text : "").join("\n");
}

test("heap cap stays well under the notebook default", () => {
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
		assert.match(redeclared.kind === "result" ? redeclared.errorText ?? "" : "", /already been declared/);
		const still = await code.execute("text(String(kept))", session("a"));
		assert.match(textOf(still), /7/);
		const failed = await code.execute("kept = 9; throw new Error('no')", session("a"));
		assert.match(failed.kind === "result" ? failed.errorText ?? "" : "", /no/);
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
		const oversized = await code.execute("store('big', 'x'.repeat(300000))", session("store"));
		assert.match(oversized.kind === "result" ? oversized.errorText ?? "" : "", /too large/);
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
		async invoke(input) { return input; },
	};
	const code = client();
	try {
		const result = await code.execute(
			"tools.echo({ text: 'pong' }).then(value => text(value.text))",
			session("tools", async call => { seen.push(call.toolName); }),
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
		const stalled = await code.execute("// @exec: {\"yield_time_ms\": 200}\nwhile (true);", session("stall"));
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
			const result = await code.execute("while (true);", session("abort"), signal);
			assert.match(result.kind === "result" ? result.errorText ?? "" : "", /cancel|dropped|abort/i);
		} catch (error) {
			assert.match(error instanceof Error ? error.message : String(error), /abort|cancel/i);
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
		assert.match(imported.kind === "result" ? imported.errorText ?? "" : "", /import/i);
		const awaited = await code.execute("await import('node:fs')", session("host"));
		assert.match(awaited.kind === "result" ? awaited.errorText ?? "" : "", /import/i);
		const kinds = await code.execute("text(typeof process + ':' + typeof require)", session("host"));
		assert.match(textOf(kinds), /undefined:undefined/);
		const generated = await code.execute("Function('return process')()", session("host"));
		assert.match(generated.kind === "result" ? generated.errorText ?? "" : "", /code generation|disallowed/i);
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
		const redeclared = await code.execute("let kept = await Promise.resolve(8)", session("await"));
		assert.match(redeclared.kind === "result" ? redeclared.errorText ?? "" : "", /already been declared/);
		await code.execute("function helper() { return 6 }\nclass Box { n() { return 5 } }\nawait Promise.resolve()", session("await"));
		const defined = await code.execute("text(String(helper() + new Box().n()))", session("await"));
		assert.match(textOf(defined), /11/);
		const hidden = await code.execute("{ let hidden = 1 }\nawait Promise.resolve()\ntext(typeof hidden)", session("await"));
		assert.match(textOf(hidden), /undefined/);
		await code.execute("const fixed = await Promise.resolve(4)", session("await"));
		const readFixed = await code.execute("text(String(fixed))", session("await"));
		assert.match(textOf(readFixed), /4/);
		const plain = await code.execute("const plain = 1\nplain = 2", session("await"));
		assert.match(plain.kind === "result" ? plain.errorText ?? "" : "", /constant/);
		const stillPlain = await code.execute("text(String(plain))", session("await"));
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
		async invoke(input) { return input; },
	};
	const code = client();
	try {
		const result = await code.execute(
			"let first = await tools.echo({ text: 'one' })\nlet second = await tools.echo({ text: first.text + 'two' })\ntext(second.text)",
			session("await-tools", async call => { seen.push(call.toolName); }),
			undefined,
			[echo],
		);
		assert.deepEqual(seen, ["echo", "echo"]);
		assert.match(textOf(result), /onetwo/);
		const rejected = await code.execute("await Promise.reject(new Error('no'))", session("await-tools"));
		assert.match(rejected.kind === "result" ? rejected.errorText ?? "" : "", /no/);
		const kept = await code.execute("text(first.text)", session("await-tools"));
		assert.match(textOf(kept), /one/);
		const thrown = await code.execute("let after = 4\nthrow new Error('later')", session("await-tools"));
		assert.match(thrown.kind === "result" ? thrown.errorText ?? "" : "", /later/);
		const after = await code.execute("text(String(after))", session("await-tools"));
		assert.match(textOf(after), /4/);
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
			const result = await code.execute("await new Promise(() => {})", session("await-abort"), signal);
			assert.match(result.kind === "result" ? result.errorText ?? "" : "", /cancel|dropped|abort/i);
		} catch (error) {
			assert.match(error instanceof Error ? error.message : String(error), /abort|cancel/i);
		}
		const fresh = await code.execute("text(typeof kept)", session("await-abort"));
		assert.match(textOf(fresh), /undefined/);
	} finally {
		await code.shutdown();
	}
});

test("memory limit drops the context and the next exec rebuilds it", async () => {
	const code = client(64);
	try {
		const failed = await code.execute("const chunks = []; for (let i = 0; i < 80; i++) { const row = new Array(100000); for (let j = 0; j < row.length; j++) row[j] = { i, j }; chunks.push(row); }", session("oom"));
		assert.match(failed.kind === "result" ? failed.errorText ?? "" : "", /memory limit/);
		const fresh = await code.execute("text(typeof chunks)", session("oom"));
		assert.match(textOf(fresh), /undefined/);
	} finally {
		await code.shutdown();
	}
});
