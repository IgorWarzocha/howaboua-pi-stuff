import test from "node:test";
import assert from "node:assert/strict";
import {
	makeSnapshot,
	mergeLayout,
	validateSnapshot,
	sessionOf,
	terminalLeaves,
} from "../src/snapshot.mjs";

const leaf = (address) => ({
	id: `pane-${address}`,
	type: "block",
	content: { terminal: address },
});
const layout = {
	spaces: [
		{ id: "s1", folder: "/tmp", tabs: [{ id: "tab1", root: leaf("t1") }] },
	],
};
test("a snapshot from another Core cannot be restored", () => {
	const result = makeSnapshot(
		layout,
		[
			{
				address: "t1",
				state: "live",
				cwd: "/tmp",
				labels: {
					"herdr.state.agent": "pi",
					"herdr.state.ref": JSON.stringify({
						kind: "path",
						value: "/tmp/exact.jsonl",
					}),
				},
			},
		],
		"core1",
	);
	assert.throws(() => validateSnapshot(result.snapshot, "core2"), /compatible/);
});
test("malformed or unsupported reported sessions do not become commands", () => {
	assert.equal(
		sessionOf({
			labels: { "herdr.state.agent": "pi", "herdr.state.ref": "oops" },
		}),
		null,
	);
	const saved = makeSnapshot(
		layout,
		[{ address: "t1", state: "live", cwd: "/tmp", status: { app: "unknown" } }],
		"core1",
	);
	assert.equal(saved.snapshot.terminals[0].session, null);
	assert.match(saved.warnings[0], /shell only/);
});
test("a saved address never replaces occupied current work without explicit permission", () => {
	const merged = mergeLayout(layout, layout, new Map([["t1", "t2"]]));
	assert.deepEqual(terminalLeaves(merged.spaces[0].tabs[0].root), ["t1", "t2"]);
	const parked = mergeLayout(
		layout,
		layout,
		new Map([["t1", "t2"]]),
		new Set(["t1"]),
	);
	assert.deepEqual(terminalLeaves(parked.spaces[0].tabs[0].root), ["t2"]);
});
