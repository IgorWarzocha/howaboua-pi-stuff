import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserRequest } from "../src/browser/request.js";

test("browser requests share one validated single and batch contract", () => {
	assert.deepEqual(parseBrowserRequest("help"), { help: true });
	assert.deepEqual(parseBrowserRequest({ action: "help" }), {
		help: true,
	});
	assert.deepEqual(
		parseBrowserRequest({
			action: "tabs",
			query: "linkedin",
		}),
		{
			operations: [
				{
					action: "tabs",
					query: "linkedin",
					offset: 0,
				},
			],
		},
	);
	assert.deepEqual(
		parseBrowserRequest(
			JSON.stringify({
				response_length: "short",
				tabs: [{ query: "linkedin" }],
				open: [{ ref_id: "ABCDEF12" }],
				click: [{ ref_id: "ABCDEF12", id: 7 }],
				raw: [
					{
						ref_id: "ABCDEF12",
						method: "DOM.getDocument",
					},
				],
			}),
		),
		{
			operations: [
				{
					action: "tabs",
					query: "linkedin",
					offset: 0,
				},
				{
					action: "open",
					ref_id: "ABCDEF12",
					lineno: 1,
					response_length: "short",
				},
				{
					action: "click",
					ref_id: "ABCDEF12",
					id: 7,
				},
				{
					action: "raw",
					ref_id: "ABCDEF12",
					method: "DOM.getDocument",
					params: {},
				},
			],
		},
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				action: "open",
				ref_id: "ABCDEF12",
				url: "https://example.com",
			}),
		/exactly one/,
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				action: "click",
				ref_id: "ABCDEF12",
				id: 1,
				selector: "a",
			}),
		/exactly one/,
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				host: "workstation",
				tabs: [{}],
			}),
		/SSH browser routing is disabled/,
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				response_length: "huge",
				tabs: [{}],
			}),
		/response_length/,
	);
});
