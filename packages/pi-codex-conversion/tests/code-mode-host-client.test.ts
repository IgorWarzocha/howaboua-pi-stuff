import assert from "node:assert/strict";
import test from "node:test";
import { CodeModeHostClient } from "../src/tools/code-mode/host-client.ts";

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
