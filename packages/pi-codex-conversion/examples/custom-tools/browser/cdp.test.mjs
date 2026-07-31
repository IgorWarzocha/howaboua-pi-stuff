import assert from "node:assert/strict";
import test from "node:test";
import { clickStr, formatPagesJson, htmlStr, snapshotData } from "./cdp.mjs";

test("tab transport preserves titles that break the human list format", () => {
	const tabs = JSON.parse(formatPagesJson([
		{ targetId: "ABCDEF123456", title: "First\nSecond", url: "https://example.com/a b" },
	]));
	assert.deepEqual(tabs, [
		{ ref_id: "ABCDEF12", title: "First\nSecond", url: "https://example.com/a b" },
	]);
});

test("selector click dispatches trusted pointer events instead of DOM click", async () => {
	const calls = [];
	const cdp = {
		async send(method, params) {
			calls.push({ method, params });
			if (method === "Runtime.evaluate")
				return { result: { value: { ok: true, tag: "A", text: "Next", x: 12, y: 34 } } };
			return {};
		},
	};
	assert.equal(await clickStr(cdp, "session", "a.next"), 'Clicked <A> "Next"');
	assert.deepEqual(
		calls.filter(call => call.method === "Input.dispatchMouseEvent").map(call => call.params.type),
		["mouseMoved", "mousePressed", "mouseReleased"],
	);
});

test("missing HTML selector is an error, not successful content", async () => {
	const cdp = {
		async send(method) {
			if (method === "Runtime.evaluate") return { result: { value: { ok: false } } };
			return {};
		},
	};
	await assert.rejects(htmlStr(cdp, "session", "#missing"), /Element not found: #missing/);
});

test("snapshot emits compact line content and numbered interactive refs", async () => {
	const cdp = {
		async send(method) {
			if (method === "Accessibility.getFullAXTree") return {
				nodes: [
					{ nodeId: "root", role: { value: "RootWebArea" }, name: { value: "" }, childIds: ["button", "text"] },
					{ nodeId: "button", parentId: "root", backendDOMNodeId: 42, role: { value: "button" }, name: { value: "Continue" }, childIds: ["button-text"] },
					{ nodeId: "button-text", parentId: "button", role: { value: "StaticText" }, name: { value: "Continue" } },
					{ nodeId: "text", parentId: "root", role: { value: "StaticText" }, name: { value: "Hello   world" } },
				],
			};
			if (method === "Runtime.evaluate")
				return { result: { value: { title: "Page", url: "https://example.com" } } };
			return {};
		},
	};
	const refs = new Map();
	const result = await snapshotData(cdp, "session", refs, { refId: "ABCDEF12", responseLength: "short" });
	assert.deepEqual(result.content, [
		{ line: 1, text: "[1] button Continue", element_id: 1 },
		{ line: 2, text: "Hello world" },
	]);
	assert.deepEqual(result.elements, [{ id: 1, role: "button", name: "Continue" }]);
	assert.equal(refs.get(1), 42);
});
