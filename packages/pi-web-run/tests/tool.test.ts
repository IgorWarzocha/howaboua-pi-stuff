import assert from "node:assert/strict";
import test from "node:test";
import { webRunCodeModeResult } from "../index.js";
import { buildWebSearchRequest } from "../src/request.js";

test("Code Mode receives reusable web refs instead of display text", () => {
	const webRun = {
		output: "Search summary",
		search_results: [{ title: "Example", url: "https://example.com" }],
	};
	assert.deepEqual(
		webRunCodeModeResult({
			content: [{ type: "text", text: webRun.output }],
			details: { webRun },
		}),
		webRun,
	);
	assert.deepEqual(
		buildWebSearchRequest(
			{
				search_query: [{ q: "BBC headlines", recency: 2 }],
				response_length: "short",
			},
			{ id: "session-1", model: "gpt-5.6-luna" },
		),
		{
			id: "session-1",
			model: "gpt-5.6-luna",
			commands: {
				search_query: [{ q: "BBC headlines", recency: 2 }],
				response_length: "short",
			},
			settings: {
				allowed_callers: ["direct"],
				external_web_access: true,
			},
			max_output_tokens: 2500,
		},
	);
});
