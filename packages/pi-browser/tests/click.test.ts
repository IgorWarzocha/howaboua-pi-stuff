import assert from "node:assert/strict";
import test from "node:test";
import { clickSelector } from "../src/cdp/actions/click.js";
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
