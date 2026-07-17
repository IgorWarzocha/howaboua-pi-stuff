import assert from "node:assert/strict";
import test from "node:test";
import { applyCodeModeFreeformContract, sanitizeCodeModeHistoryForFunctionTools } from "../src/adapter/code-mode-contract.ts";

test("Code Mode rewrites exec history to custom tool items", () => {
	const body = applyCodeModeFreeformContract({
		tools: [
			{
				type: "function",
				name: "exec",
				description: "Compose",
				parameters: { type: "object" },
			},
		],
		input: [
			{
				type: "function_call",
				id: "fc_1",
				call_id: "call_1",
				name: "exec",
				arguments: JSON.stringify({ code: "text(42);" }),
			},
			{ type: "function_call_output", call_id: "call_1", output: "42" },
		],
	});
	assert.equal((body.tools?.[0] as { type: string }).type, "custom");
	assert.deepEqual(body.input, [
		{
			type: "custom_tool_call",
			call_id: "call_1",
			name: "exec",
			input: "text(42);",
		},
		{ type: "custom_tool_call_output", call_id: "call_1", output: "42" },
	]);
});

test("function-tool replay drops Code Mode item ids", () => {
	const body = sanitizeCodeModeHistoryForFunctionTools({
		input: [
			{ type: "function_call", id: "ctc_1", call_id: "call_1", name: "exec", arguments: "{}" },
			{ type: "function_call", id: "fc_2", call_id: "call_2", name: "wait", arguments: "{}" },
			{ type: "function_call", id: "vendor_3", call_id: "call_3", name: "search", arguments: "{}" },
		],
	});
	assert.deepEqual(body.input, [
		{ type: "function_call", call_id: "call_1", name: "exec", arguments: "{}" },
		{ type: "function_call", id: "fc_2", call_id: "call_2", name: "wait", arguments: "{}" },
		{ type: "function_call", id: "vendor_3", call_id: "call_3", name: "search", arguments: "{}" },
	]);
});
