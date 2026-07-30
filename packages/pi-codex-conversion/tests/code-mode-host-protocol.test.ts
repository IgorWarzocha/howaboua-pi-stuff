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
	);
	assert.throws(
		() => parseRuntimeResponse({
			Result: {
				cell_id: "cell-1",
				content_items: [{ type: "input_image" }],
			},
		}),
	);
	assert.throws(
		() => parseRuntimeResponse({
			Result: {
				cell_id: "cell-1",
				content_items: [{ type: "input_audio", audio_url: "data:audio/wav;base64,AA==" }],
			},
		}),
	);
});
