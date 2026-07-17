import assert from "node:assert/strict";
import test from "node:test";
import { CodeModeHostClient } from "../src/tools/code-mode/host-client.ts";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";

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
