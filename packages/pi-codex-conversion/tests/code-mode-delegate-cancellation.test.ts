import assert from "node:assert/strict";
import test from "node:test";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";
import { PiToolCallScope } from "../src/tools/code-mode/pi-tool-call-scope.ts";
import { createMcpCodeModeBridge } from "../src/adapter/code-mode/mcp-tools.ts";

test("nested cell lifecycle preserves cancellation, blockers, and resumed progress", async () => {
	const runtime = new CodeModeDelegateRuntime(() => undefined);
	let started!: () => void;
	const active = new Promise<void>((resolve) => { started = resolve; });
	const calls: string[] = [];
	const firstScope = new PiToolCallScope({
		async executeTool(_name: string, _input: unknown, { signal }: { signal: AbortSignal }) {
			calls.push("exec");
			started();
			await new Promise<void>((_resolve, reject) => signal.addEventListener(
				"abort",
				() => reject(new Error("nested tool cancelled")),
				{ once: true },
			));
		},
	} as never);
	const native = { name: "mcp__records__read", description: "Read a record", parameters: { type: "object" } };
	const mcp = createMcpCodeModeBridge({ getAllTools: () => [{ ...native, sourceInfo: { path: "builtin:mcp" } }] } as never);
	mcp.prepareLoadout({ callable: [native], getNamespace: () => undefined } as never);
	runtime.bindCell("cell-a", {
		cwd: process.cwd(), piToolScope: firstScope,
		preflight: async () => assert.fail("MCP permissions belong to Pi's executor"),
		completion: async () => assert.fail("MCP completion belongs to Pi's executor"),
	}, new Map(mcp.getTools().map((tool) => [tool.name, tool])));
	const pending = runtime.invokeDirect("cell-a", 1, native.name, {});
	await active;
	let closed = false;
	const closing = firstScope.close().then(() => { closed = true; });
	await Promise.resolve();
	assert.equal(closed, false, "outer result waits for its native calls");
	runtime.cancelCell("cell-a");
	await assert.rejects(pending, /nested tool cancelled/);
	await closing;
	const resumed = runtime.invokeDirect("cell-a", 2, native.name, {});
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, ["exec"], "a yielded cell cannot reuse retired parent IDs");
	const structuredContent = {
		content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
		structuredContent: { value: "x".repeat(30_000) }, isError: true,
	};
	let result: { content: Array<{ type: "text"; text: string }>; details: object; structuredContent?: unknown } = {
		content: [{ type: "text", text: "truncated for display" }], details: {}, structuredContent,
	};
	const secondScope = new PiToolCallScope({
		async executeTool() {
			calls.push("wait");
			return { result, isError: true };
		},
	} as never);
	runtime.updateCellContext("cell-a", { cwd: process.cwd(), piToolScope: secondScope });
	assert.deepEqual(await resumed, structuredContent);
	assert.deepEqual(calls, ["exec", "wait"]);
	result = { content: [{ type: "text", text: "Permission denied" }], details: {} };
	await assert.rejects(runtime.invokeDirect("cell-a", 3, native.name, {}), /Permission denied/);
	await secondScope.close();
	const suspended = runtime.invokeDirect("cell-a", 4, native.name, {});
	await new Promise<void>((resolve) => setImmediate(resolve));
	runtime.cancelCell("cell-a");
	await assert.rejects(suspended, /abort/i);

	let releaseFirst!: () => void;
	let firstStarted!: () => void;
	let releaseAskPreflight!: () => void;
	const firstActive = new Promise<void>((resolve) => { firstStarted = resolve; });
	const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
	const askPreflightGate = new Promise<void>((resolve) => {
		releaseAskPreflight = resolve;
	});
	const blockerStates: boolean[] = [];
	const queued = new CodeModeDelegateRuntime(() => undefined);
	queued.bindCell("cell-b", {
		cwd: process.cwd(),
		setBlocked: (_id, active) => blockerStates.push(active),
		toolCallId: "outer",
		extensionContext: {} as never,
		preflight: async ({ toolName }) => {
			if (toolName === "ask") await askPreflightGate;
		},
	}, new Map([
		["first", {
			name: "first",
			usage: "first({})",
			deferLoading: false,
			kind: "function",
			executionMode: "sequential",
			async invoke() {
				firstStarted();
				await firstGate;
			},
		}],
		["ask", {
			name: "ask",
			usage: "ask({})",
			deferLoading: false,
			kind: "function",
			executionMode: "sequential",
			isBlocking: (input: unknown) =>
				typeof input === "object" &&
				input !== null &&
				"blocking" in input &&
				input.blocking === true,
			async invoke() {},
		}],
	]));
	const first = queued.invokeDirect("cell-b", 1, "first", {});
	await firstActive;
	const ask = queued.invokeDirect("cell-b", 2, "ask", { blocking: true });
	await Promise.resolve();
	assert.equal(queued.isBlocked("cell-b"), true);
	assert.deepEqual(blockerStates, [true]);
	releaseAskPreflight();
	releaseFirst();
	await Promise.all([first, ask]);
	assert.equal(queued.isBlocked("cell-b"), false);
	assert.deepEqual(blockerStates, [true, false]);

	let reportProgress!: (text: string) => void;
	let finishProgress!: () => void;
	let progressStarted!: () => void;
	const progressActive = new Promise<void>((resolve) => { progressStarted = resolve; });
	const progressGate = new Promise<void>((resolve) => { finishProgress = resolve; });
	const originalUpdates: string[] = [];
	const resumedUpdates: string[] = [];
	const progress = new CodeModeDelegateRuntime(() => undefined);
	progress.bindCell("cell-c", {
		cwd: process.cwd(),
		onUpdate: (update) => originalUpdates.push(JSON.stringify(update)),
	}, new Map([["progress", {
		name: "progress",
		usage: "progress({})",
		deferLoading: false,
		kind: "function",
		async invoke(_input, context) {
			reportProgress = (text) => context.onUpdate?.({
				content: [{ type: "text", text }],
				details: {},
			});
			progressStarted();
			await progressGate;
			return "done";
		},
	}]]));
	const progressing = progress.invokeDirect("cell-c", 1, "progress", {});
	await progressActive;
	progress.updateCellContext("cell-c", {
		cwd: process.cwd(),
		onUpdate: (update) => resumedUpdates.push(JSON.stringify(update)),
	});
	reportProgress("halfway");
	finishProgress();
	await progressing;
	assert.equal(originalUpdates.some((update) => update.includes("halfway")), false);
	assert.equal(resumedUpdates.some((update) => update.includes("halfway")), true);
});
