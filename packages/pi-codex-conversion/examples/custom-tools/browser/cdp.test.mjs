import assert from "node:assert/strict";
import test from "node:test";
import { clickStr, htmlStr, snapshotData, typeRefStr } from "./cdp.mjs";

test("browser mutations preserve trusted click and safe typing boundaries", async () => {
	const blockedCalls = [];
	let blockedHitTests = 0;
	const blocked = {
		async send(method, params) {
			blockedCalls.push({ method, params });
			if (method === "Runtime.evaluate")
				return { result: { objectId: "selected" } };
			if (method === "DOM.describeNode") return { node: { backendNodeId: 42 } };
			if (method === "DOM.resolveNode")
				return { object: { objectId: "target" } };
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("getBoundingClientRect")
			) {
				blockedHitTests++;
				return {
					result: {
						value:
							blockedHitTests === 1
								? { ok: true, tag: "A", text: "Next", x: 12, y: 34 }
								: { ok: false, error: "Element center is covered by <dialog>" },
					},
				};
			}
			return {};
		},
	};
	await assert.rejects(
		clickStr(blocked, "session", "a.next"),
		/covered by <dialog>/,
	);
	assert.deepEqual(
		blockedCalls
			.filter((call) => call.method === "Input.dispatchMouseEvent")
			.map((call) => call.params.type),
		["mouseMoved"],
	);

	let releases = 0;
	const releaseFailure = {
		async send(method, params) {
			if (method === "Runtime.evaluate")
				return { result: { objectId: "selected" } };
			if (method === "DOM.describeNode") return { node: { backendNodeId: 42 } };
			if (method === "DOM.resolveNode")
				return { object: { objectId: "target" } };
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("getBoundingClientRect")
			)
				return {
					result: { value: { ok: true, tag: "A", text: "Next", x: 12, y: 34 } },
				};
			if (
				method === "Input.dispatchMouseEvent" &&
				params.type === "mouseReleased" &&
				++releases === 1
			)
				throw new Error("release failed");
			return {};
		},
	};
	await assert.rejects(
		clickStr(releaseFailure, "session", "a.next"),
		/release failed/,
	);
	assert.equal(releases, 2);

	const drifted = {
		async send(method, params) {
			if (method === "DOM.resolveNode")
				return { object: { objectId: "field" } };
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("getBoundingClientRect")
			)
				return { result: { value: { ok: true, x: 12, y: 34 } } };
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("this.focus")
			)
				return { result: { value: { ok: true, tag: "INPUT", before: "" } } };
			if (method === "Runtime.callFunctionOn")
				return { result: { value: false } };
			return {};
		},
	};
	await assert.rejects(
		typeRefStr(drifted, "session", new Map([[7, 42]]), "7", "hello"),
		/Focus changed before typing/,
	);

	const buttonCalls = [];
	const button = {
		async send(method, params) {
			buttonCalls.push({ method, params });
			if (method === "DOM.resolveNode")
				return { object: { objectId: "button" } };
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("getBoundingClientRect")
			)
				return { result: { value: { ok: true, x: 12, y: 34 } } };
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("this.focus")
			)
				return {
					result: { value: { ok: false, error: "<BUTTON> is not editable" } },
				};
			return {};
		},
	};
	await assert.rejects(
		typeRefStr(button, "session", new Map([[8, 43]]), "8", "no"),
		/not editable/,
	);
	assert.equal(
		buttonCalls.some((call) => call.method === "Input.dispatchMouseEvent"),
		false,
	);
	assert.equal(
		buttonCalls.some((call) => call.method === "Input.insertText"),
		false,
	);
	assert.equal(
		buttonCalls.filter(
			(call) =>
				call.method === "Runtime.releaseObject" &&
				call.params.objectId === "button",
		).length,
		buttonCalls.filter((call) => call.method === "DOM.resolveNode").length,
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
	let snapshotNumber = 0;
	const cdp = {
		async send(method) {
			if (method === "Accessibility.getFullAXTree") {
				snapshotNumber++;
				return {
					nodes: [
						{ nodeId: "root", role: { value: "RootWebArea" }, name: { value: "" }, childIds: ["button", "menu", "text"] },
						{ nodeId: "button", parentId: "root", backendDOMNodeId: 40 + snapshotNumber, role: { value: "button" }, name: { value: "Continue" }, childIds: ["button-text"] },
						{ nodeId: "button-text", parentId: "button", role: { value: "StaticText" }, name: { value: "Continue" } },
						{ nodeId: "menu", parentId: "root", backendDOMNodeId: 80 + snapshotNumber, role: { value: "menuitemcheckbox" }, name: { value: "Show archived" } },
						{ nodeId: "text", parentId: "root", role: { value: "StaticText" }, name: { value: "Hello   world" } },
					],
				};
			}
			if (method === "Runtime.evaluate")
				return { result: { value: { title: "Page", url: "https://example.com" } } };
			return {};
		},
	};
	const refs = new Map();
	const result = await snapshotData(cdp, "session", refs, { refId: "ABCDEF12", responseLength: "short" });
	assert.deepEqual(result.content, [
		{ line: 1, text: "[1] button Continue", element_id: 1 },
		{ line: 2, text: "[2] menuitemcheckbox Show archived", element_id: 2 },
		{ line: 3, text: "Hello world" },
	]);
	assert.deepEqual(result.elements, [
		{ id: 1, role: "button", name: "Continue" },
		{ id: 2, role: "menuitemcheckbox", name: "Show archived" },
	]);
	assert.equal(refs.get(1), 41);
	const next = await snapshotData(cdp, "session", refs, { refId: "ABCDEF12", responseLength: "short" });
	assert.deepEqual(next.elements.map((element) => element.id), [3, 4]);
	assert.equal(refs.has(1), false);
	assert.equal(refs.get(3), 42);
	await assert.rejects(snapshotData(cdp, "session", refs, { lineno: Number.NaN }), /line cursor/);
	await assert.rejects(snapshotData(cdp, "session", refs, { responseLength: "huge" }), /response length/);
});
