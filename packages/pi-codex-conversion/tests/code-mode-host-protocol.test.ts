import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeResponse } from "../src/tools/code-mode/host-protocol.ts";

test("Code Mode host protocol rejects malformed runtime content", () => {
	assert.throws(
		() => parseRuntimeResponse({
			Result: {
				cell_id: "cell-1",
				content_items: [null],
			},
		}),
		/invalid content item/,
	);
	assert.throws(
		() => parseRuntimeResponse({
			Result: {
				cell_id: "cell-1",
				content_items: [{ type: "input_image" }],
			},
		}),
		/invalid content item/,
	);
});
