import assert from "node:assert/strict";
import test from "node:test";

import {
	parseRequest,
	publicResult,
	slugify,
	uniqueName,
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
	assert.equal(
		parseRequest(
			JSON.stringify({
				action: "spawn",
				agent_type: "explorer",
				label: "Remote task",
				name: "Tidy desktop downloads",
				message: "Tidy the downloads directory",
				host: "desktop",
			}),
		).host,
		"desktop",
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
	assert.throws(
		() => parseRequest(JSON.stringify({ action: "find", status: "done" })),
		/unknown find field/,
	);
	assert.throws(
		() => parseRequest(JSON.stringify({ action: "find", include_self: true })),
		/unknown find field/,
	);
	assert.deepEqual(
		parseRequest(
			JSON.stringify({
				action: "send",
				target: "w1:p2",
				message: "Check the compatibility path",
				blocking: false,
			}),
		),
		{
			action: "send",
			target: "w1:p2",
			message: "Check the compatibility path",
			blocking: false,
		},
	);
	assert.throws(
		() =>
			parseRequest(
				JSON.stringify({
					action: "send",
					target: "w1:p2",
					text: "legacy",
				}),
			),
		/unknown send field/,
	);
	assert.deepEqual(
		parseRequest(JSON.stringify({ action: "read", target: "w1:p2" })),
		{ action: "read", target: "w1:p2" },
	);
	assert.throws(
		() => parseRequest(JSON.stringify({ action: "read", target: "w1:p2", lines: 40 })),
		/unknown read field/,
	);
	assert.throws(
		() => parseRequest(JSON.stringify({ action: "wait", target: "w1:p2" })),
		/use read/,
	);
	assert.deepEqual(
		parseRequest(
			JSON.stringify({
				action: "answer",
				target: "w1:p2",
				answers: [{ selections: ["Blue"] }],
			}),
		),
		{
			action: "answer",
			target: "w1:p2",
			answers: [{ selections: ["Blue"] }],
		},
	);
	assert.throws(
		() =>
			parseRequest(
				JSON.stringify({
					action: "answer",
					target: "w1:p2",
					answers: [],
					wait: false,
				}),
			),
		/unknown answer field/,
	);
});

test("labels become valid unique Herdr agent names", () => {
	assert.equal(slugify("Auth Review"), "auth-review");
	assert.deepEqual(uniqueName("Auth Review", new Set(["auth-review"])), {
		name: "auth-review-2",
		suffix: 2,
	});
	assert.match(slugify("123 cache checks"), /^[a-z][a-z0-9-]{0,31}$/u);
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

	const blocked = publicResult({
		pane: "w1:p2",
		status: "blocked",
		ask: { handoff: false, prompts: [] },
	});
	assert.equal(blocked.status, "blocked");
	assert.deepEqual(blocked.ask, { handoff: false, prompts: [] });
	assert.equal(typeof blocked.next, "string");

	assert.deepEqual(
		publicResult({ panels: [{ id: "w1:p2", status: "idle", label: "reviewer" }] }),
		{ agents: [{ target: "w1:p2", status: "idle", label: "reviewer" }] },
	);
});
