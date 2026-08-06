import assert from "node:assert/strict";
import test from "node:test";
import { codeModeWebResult } from "../src/adapter/code-mode/nested-tool-adapter.ts";

test("Code Mode web results expose URL-bearing search metadata", () => {
	const webRun = {
		output: "Search summary with internal refs",
		search_results: [
			{ title: "Example", url: "https://example.com/source" },
		],
	};

	assert.deepEqual(codeModeWebResult({
		content: [{ type: "text", text: webRun.output }],
		details: { webRun },
	}), webRun);
});
