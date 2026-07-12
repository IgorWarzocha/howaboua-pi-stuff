import assert from "node:assert/strict";
import test from "node:test";
import {
	parseHostMessage,
	parseRuntimeResponse,
} from "../src/tools/code-mode/host-protocol.ts";

test("Code Mode host protocol accepts the pinned handshake", () => {
	assert.deepEqual(
		parseHostMessage({
			type: "connection/ready",
			selectedVersion: 1,
			capabilities: [],
		}),
		{
			type: "connection/ready",
			selectedVersion: 1,
			capabilities: [],
		},
	);
	assert.throws(
		() => parseHostMessage({
			type: "connection/ready",
			selectedVersion: 2,
			capabilities: [],
		}),
		/invalid protocol/,
	);
});

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
