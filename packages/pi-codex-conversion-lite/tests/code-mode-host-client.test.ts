import assert from "node:assert/strict";
import test from "node:test";
import { CodeModeHostClient } from "../src/tools/code-mode/host-client.ts";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";

test("Code Mode uses a 30-second initial exec default without overriding pragmas", async () => {
	const client = new CodeModeHostClient({ binary: "unused", tools: [] });
	const yields: unknown[] = [];
	const internals = client as unknown as {
		start(): Promise<void>;
		initial: Map<number, { resolve(value: unknown): void }>;
		requestWithId(id: number, message: { request: { yield_time_ms: unknown } }): Promise<unknown>;
	};
	internals.start = async () => undefined;
	internals.requestWithId = async (id, message) => {
		yields.push(message.request.yield_time_ms);
		queueMicrotask(() => internals.initial.get(id)?.resolve({ Result: { cell_id: `cell-${id}`, content_items: [] } }));
		return { type: "execution/started", cellId: `cell-${id}` };
	};

	await client.execute("text('default')", { cwd: process.cwd() });
	await client.execute('// @exec: {"yield_time_ms": 7000}\ntext("explicit")', { cwd: process.cwd() });

	assert.deepEqual(yields, [30_000, 7_000]);
});

test("Code Mode forces teardown when graceful host shutdown stalls", async () => {
	const client = new CodeModeHostClient({ binary: "unused", tools: [], shutdownGraceMs: 5 });
	let killed = false;
	const internals = client as unknown as {
		child: { killed: boolean; kill(): void };
		request(): Promise<unknown>;
	};
	internals.child = {
		killed: false,
		kill() {
			killed = true;
			this.killed = true;
		},
	};
	internals.request = () => new Promise(() => undefined);

	await client.shutdown();

	assert.equal(killed, true);
});

test("Code Mode shutdown cancels pending host preparation", async () => {
	const runtime = new SharedCodeModeRuntime();
	const startupAbort = new AbortController();
	const internals = runtime as unknown as {
		clientPromise?: Promise<never>;
		clientStartupAbort?: AbortController;
	};
	internals.clientStartupAbort = startupAbort;
	internals.clientPromise = new Promise((_, reject) => {
		startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
	});

	await runtime.shutdownHost();

	assert.equal(startupAbort.signal.aborted, true);
	assert.equal(internals.clientPromise, undefined);
	assert.equal(internals.clientStartupAbort, undefined);
});
