import assert from "node:assert/strict";
import test from "node:test";

import {
	parseRequest,
	publicResult,
} from "./agents.mjs";

test("public requests keep the small caller decision surface", () => {
	assert.deepEqual(
		parseRequest(
			JSON.stringify({
				action: "spawn",
				agent_type: "explorer",
				label: "Auth search",
				name: "Investigate authentication routing",
				message: "Find the owner of authentication routing",
			}),
		),
		{
			action: "spawn",
			agent_type: "explorer",
			label: "Auth search",
			name: "Investigate authentication routing",
			message: "Find the owner of authentication routing",
			blocking: true,
		},
	);
	assert.throws(
		() =>
			parseRequest(
				JSON.stringify({
					action: "spawn",
					agent_type: "explorer",
					label: "Too many words for label",
					name: "Search",
					message: "Search",
				}),
			),
		/2 or 3 words/,
	);
});

test("public results hide coordination machinery", () => {
	const settled = publicResult(
		{ pane: "w1:p2", status: "done", text: "result", mode: "prompt" },
		"reviewer",
	);
	assert.deepEqual(settled, { target: "reviewer", reply: "result" });

	const sent = publicResult({
		pane: "w1:p2",
		host: "desktop",
		sent: true,
		delivery: "server_prompt",
	});
	assert.deepEqual(sent.next.request, {
		action: "read",
		target: "w1:p2",
		host: "desktop",
	});
	assert.equal("delivery" in sent, false);

});
