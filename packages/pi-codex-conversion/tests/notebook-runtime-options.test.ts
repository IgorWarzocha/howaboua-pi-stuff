import assert from "node:assert/strict";
import test from "node:test";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";

test("Notebook runtime replacement applies changed heap and profile options", async () => {
	const runtime = new SharedCodeModeRuntime();
	let maxHeapMiB = 512;
	let profile: string | undefined;
	runtime.addProvider({
		getTools: () => [],
		executionKind: () => "notebook",
		notebookOptions: () => ({ maxHeapMiB, agentDir: "/tmp/pi-notebook-options", ...(profile ? { profile } : {}) }),
	});
	try {
		const initial = await runtime.getClient();
		maxHeapMiB = 1_024;
		profile = "review";
		const updated = await runtime.getClient();
		assert.notEqual(updated, initial);
	} finally {
		await runtime.shutdownHost();
	}
});
