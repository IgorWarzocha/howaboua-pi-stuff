import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cdpTimeoutAttempts, clickStr, formatPagesJson, getTargetRef, htmlStr, snapshotData, typeRefStr } from "./cdp.mjs";

test("CDP transport and entry routing preserve protocol boundaries", async () => {
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

	const directory = mkdtempSync(join(tmpdir(), "browser-cdp-entry-"));
	try {
		const entries = [
			{
				path: fileURLToPath(new URL("./cdp.mjs", import.meta.url)),
				link: join(directory, "codex-cdp"),
				start: true,
			},
			{
				path: fileURLToPath(new URL("../../../../pi-skill-chrome-cdp/skills/chrome-cdp/scripts/cdp.mjs", import.meta.url)),
				link: join(directory, "skill-cdp"),
				start: false,
			},
		];
		for (const entry of entries) {
			symlinkSync(entry.path, entry.link);
			const result = spawnSync(process.execPath, [entry.link, "--help"], {
				encoding: "utf8",
			});
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, / {2}list\s+List open pages/);
			assert.equal(/ {2}start\s+Start the authenticated/.test(result.stdout), entry.start);
		}
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
});

test("browser mutations preserve trusted click and safe typing boundaries", async () => {
	const calls = [];
	const cdp = {
		async send(method, params) {
			calls.push({ method, params });
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
			return {};
		},
	};
	assert.equal(await clickStr(cdp, "session", "a.next"), 'Clicked <A> "Next"');
	assert.deepEqual(
		calls
			.filter((call) => call.method === "Input.dispatchMouseEvent")
			.map((call) => call.params.type),
		["mouseMoved", "mousePressed", "mouseReleased"],
	);
	const hitTests = calls.filter(
		(call) =>
			call.method === "Runtime.callFunctionOn" &&
			call.params.functionDeclaration.includes("getBoundingClientRect"),
	);
	assert.equal(hitTests.length, 2);
	assert.match(
		hitTests[0].params.functionDeclaration,
		/root\.elementFromPoint/,
	);
	assert.equal(
		calls.filter(
			(call) =>
				call.method === "Runtime.releaseObject" &&
				call.params.objectId === "target",
		).length,
		calls.filter((call) => call.method === "DOM.resolveNode").length,
	);

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

	const typeCalls = [];
	const editable = {
		async send(method, params) {
			typeCalls.push({ method, params });
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
			if (
				method === "Runtime.callFunctionOn" &&
				params.functionDeclaration.includes("function(before)")
			)
				return { result: { value: { active: true, changed: true } } };
			if (method === "Runtime.callFunctionOn")
				return { result: { value: true } };
			return {};
		},
	};
	assert.equal(
		await typeRefStr(editable, "session", new Map([[7, 42]]), "7", "hello"),
		"Typed 5 characters into referenced <INPUT>",
	);
	assert.equal(
		typeCalls.some((call) => call.method === "Input.dispatchMouseEvent"),
		false,
	);
	assert.equal(
		typeCalls.some((call) => call.method === "Runtime.evaluate"),
		false,
	);
	assert.equal(
		typeCalls
			.filter((call) => call.method === "Runtime.callFunctionOn")
			.every((call) => call.params.objectId === "field"),
		true,
	);
	assert.equal(
		typeCalls.filter(
			(call) =>
				call.method === "Runtime.releaseObject" &&
				call.params.objectId === "field",
		).length,
		typeCalls.filter((call) => call.method === "DOM.resolveNode").length,
	);
	await assert.rejects(
		typeRefStr(editable, "session", new Map([[7, 42]]), "7junk", "hello"),
		/element id must be a positive integer/,
	);

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
	await assert.rejects(snapshotData(cdp, "session", refs, { lineno: Number.NaN }), /line cursor/);
	await assert.rejects(snapshotData(cdp, "session", refs, { responseLength: "huge" }), /response length/);
});
