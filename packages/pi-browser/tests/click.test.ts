import assert from "node:assert/strict";
import test from "node:test";
import { clickSelector } from "../src/cdp/actions/click.js";
import { typeRef } from "../src/cdp/actions/type.js";
import { FakeCdp } from "./fake-cdp.js";

test("clicks verify the hit target before dispatching a press", async () => {
	let hitTests = 0;
	const cdp = new FakeCdp(({ method, params }) => {
		if (method === "Runtime.evaluate") {
			return { result: { objectId: "selected" } };
		}
		if (method === "DOM.describeNode") {
			return { node: { backendNodeId: 42 } };
		}
		if (method === "DOM.resolveNode") {
			return { object: { objectId: "target" } };
		}
		if (
			method === "Runtime.callFunctionOn" &&
			String(params["functionDeclaration"]).includes("getBoundingClientRect")
		) {
			hitTests++;
			return {
				result: {
					value:
						hitTests === 1
							? {
									ok: true,
									tag: "A",
									text: "Next",
									x: 12,
									y: 34,
								}
							: {
									ok: false,
									error: "Element center is covered by <dialog>",
								},
				},
			};
		}
		return {};
	});
	await assert.rejects(
		clickSelector(cdp, "session", "a.next"),
		/covered by <dialog>/,
	);
	assert.deepEqual(
		cdp.calls
			.filter((call) => call.method === "Input.dispatchMouseEvent")
			.map((call) => call.params["type"]),
		["mouseMoved"],
	);
});

test("referenced typing keeps focus and verifies the edit", async () => {
	const cdp = new FakeCdp(({ method, params }) => {
		if (method === "DOM.resolveNode") {
			return { object: { objectId: "field" } };
		}
		if (
			method === "Runtime.callFunctionOn" &&
			String(params["functionDeclaration"]).includes("getBoundingClientRect")
		) {
			return {
				result: {
					value: { ok: true, x: 12, y: 34 },
				},
			};
		}
		if (
			method === "Runtime.callFunctionOn" &&
			String(params["functionDeclaration"]).includes("this.focus")
		) {
			return {
				result: {
					value: {
						ok: true,
						tag: "INPUT",
						before: "",
					},
				},
			};
		}
		if (
			method === "Runtime.callFunctionOn" &&
			String(params["functionDeclaration"]).includes("function(before)")
		) {
			return {
				result: {
					value: { active: true, changed: true },
				},
			};
		}
		if (method === "Runtime.callFunctionOn") {
			return { result: { value: true } };
		}
		return {};
	});
	assert.equal(
		await typeRef(cdp, "session", new Map([[7, 42]]), 7, "hello"),
		"Typed 5 characters into referenced <INPUT>",
	);
	assert.equal(
		cdp.calls.some(
			(call) =>
				call.method === "Input.dispatchMouseEvent" ||
				call.method === "Runtime.evaluate",
		),
		false,
	);
});
