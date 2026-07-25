import assert from "node:assert/strict";
import test from "node:test";
import { CodeModeHostClient } from "../src/tools/code-mode/host-client.ts";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";

test("Code Mode applies private programmatic-tool yield policy without rewriting source", async () => {
	const client = new CodeModeHostClient({ binary: "unused", tools: [] });
	const requests: Array<{ source: string; yield_time_ms: unknown }> = [];
	const internals = client as unknown as {
		start(): Promise<void>;
		initial: Map<number, { resolve(value: unknown): void }>;
		requestWithId(id: number, message: { request: { source: string; yield_time_ms: unknown } }): Promise<unknown>;
	};
	internals.start = async () => undefined;
	internals.requestWithId = async (id, message) => {
		requests.push({ source: message.request.source, yield_time_ms: message.request.yield_time_ms });
		queueMicrotask(() => internals.initial.get(id)?.resolve({ Result: { cell_id: `cell-${id}`, content_items: [] } }));
		return { type: "execution/started", cellId: `cell-${id}` };
	};
	const sources = [
		"await tools.long_task({ value: 1 })",
		'await tools["long_task"]({ value: 2 })',
	];
	const tools = [{
		name: "long_task",
		usage: "await tools.long_task({ value: number })",
		deferLoading: false,
		kind: "function",
		inputSchema: { type: "object" },
		yieldTimeMs: 120_000,
		invoke: async () => "done",
	}] as const;

	for (const source of sources)
		await client.execute(source, { cwd: process.cwd() }, undefined, [...tools]);

	assert.deepEqual(requests, sources.map((source) => ({ source, yield_time_ms: 120_000 })));
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
