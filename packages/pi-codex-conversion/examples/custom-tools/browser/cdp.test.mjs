import assert from "node:assert/strict";
import test from "node:test";
import { cdpTimeoutAttempts, clickStr, formatPagesJson, getTargetRef, htmlStr, snapshotData, typeRefStr } from "./cdp.mjs";

test("CDP transport preserves protocol boundaries", async () => {
	const tabs = JSON.parse(formatPagesJson([
		{ targetId: "ABCDEF120000", title: "First\nSecond", url: "https://example.com/a b" },
		{ targetId: "ABCDEF121111", title: "Second", url: "https://example.com/second" },
	]));
	assert.deepEqual(tabs, [
		{ ref_id: "ABCDEF120", title: "First\nSecond", url: "https://example.com/a b" },
		{ ref_id: "ABCDEF121", title: "Second", url: "https://example.com/second" },
	]);
	assert.equal(await getTargetRef({
		async send() {
			return { targetInfos: [
				{ type: "page", targetId: "ABCDEF120000", url: "https://example.com/a" },
				{ type: "page", targetId: "ABCDEF121111", url: "https://example.com/b" },
			] };
		},
	}, "ABCDEF120000"), "ABCDEF120");
	assert.equal(cdpTimeoutAttempts("Page.captureScreenshot"), 2);
	assert.equal(cdpTimeoutAttempts("Accessibility.getFullAXTree"), 2);
	assert.equal(cdpTimeoutAttempts("Runtime.enable"), 2);
	assert.equal(cdpTimeoutAttempts("Runtime.evaluate"), 1);
});

test("browser mutations preserve trusted click and safe typing boundaries", async () => {
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

	const blockedCalls = [];
	const blocked = {
		async send(method) {
			blockedCalls.push(method);
			if (method === "Runtime.evaluate")
				return { result: { value: { ok: false, error: "Element center is covered by <dialog>: a.next" } } };
			return {};
		},
	};
	await assert.rejects(clickStr(blocked, "session", "a.next"), /covered by <dialog>/);
	assert.equal(blockedCalls.includes("Input.dispatchMouseEvent"), false);

	const typeCalls = [];
	const editable = {
		async send(method, params) {
			typeCalls.push({ method, params });
			if (method === "DOM.resolveNode") return { object: { objectId: "field" } };
			if (method === "Runtime.callFunctionOn")
				return { result: { value: typeCalls.filter(call => call.method === "Runtime.callFunctionOn").length === 1
					? { ok: true, x: 12, y: 34 }
					: { ok: true } } };
			if (method === "Runtime.evaluate") return {
				result: { value: typeCalls.filter(call => call.method === "Runtime.evaluate").length === 1
					? { ok: true, tag: "INPUT", inspectable: true, before: "" }
					: { focused: true, tag: "INPUT", value: "hello" } },
			};
			return {};
		},
	};
	assert.equal(
		await typeRefStr(editable, "session", new Map([[7, 42]]), "7", "hello"),
		"Typed 5 characters into focused <INPUT>",
	);
	assert.equal(typeCalls.some(call => call.method === "Input.dispatchMouseEvent"), false);

	const buttonCalls = [];
	const button = {
		async send(method) {
			buttonCalls.push(method);
			if (method === "DOM.resolveNode") return { object: { objectId: "button" } };
			if (method === "Runtime.callFunctionOn")
				return { result: { value: buttonCalls.filter(call => call === "Runtime.callFunctionOn").length === 1
					? { ok: true, x: 12, y: 34 }
					: { ok: false, error: "<BUTTON> is not editable" } } };
			return {};
		},
	};
	await assert.rejects(typeRefStr(button, "session", new Map([[8, 43]]), "8", "no"), /not editable/);
	assert.equal(buttonCalls.includes("Input.dispatchMouseEvent"), false);
	assert.equal(buttonCalls.includes("Input.insertText"), false);
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
