import assert from "node:assert/strict";
import test from "node:test";
import { clickSelector } from "../src/cdp/actions/click.js";
import { pressKey } from "../src/cdp/actions/key.js";
import { FakeCdp } from "./fake-cdp.js";

test("input dispatch verifies click targets and releases keys after cancellation", async () => {
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
	const controller = new AbortController();
	const keyboard = new FakeCdp(({ params }) => {
		if (params["key"] === "a" && params["type"] === "rawKeyDown") {
			controller.abort(new Error("Cancelled after key dispatch"));
			throw controller.signal.reason;
		}
		return {};
	});
	await assert.rejects(
		pressKey(keyboard, "session", "Control+a", controller.signal),
		/Cancelled/,
	);
	assert.deepEqual(
		keyboard.calls.map(({ params }) => [
			params["type"],
			params["key"],
			params["modifiers"],
		]),
		[
			["rawKeyDown", "Control", 2],
			["rawKeyDown", "a", 2],
			["keyUp", "a", 2],
			["keyUp", "Control", 0],
		],
	);
	assert.equal(
		keyboard.calls.some(({ params }) => "text" in params),
		false,
	);
});
