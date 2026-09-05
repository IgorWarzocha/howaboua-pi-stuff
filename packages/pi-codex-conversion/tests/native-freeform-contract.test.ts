import assert from "node:assert/strict";
import test from "node:test";
import { CODE_MODE_EXEC_GRAMMAR } from "../src/tools/code-mode/exec-contract.ts";
import { registerPublicCodeModeTools } from "../src/tools/code-mode/public-tools.ts";
import {
	convertResponsesMessages,
	convertResponsesTools,
} from "../src/providers/openai-responses/shared.ts";
import { buildRequestBody } from "../src/providers/openai-codex/request-body.ts";

const exec = {
	name: "exec",
	description: "Compose tools",
	parameters: {
		type: "object",
		properties: { code: { type: "string" } },
		required: ["code"],
	},
	constrainedSampling: {
		type: "grammar",
		variants: { openai_lark: CODE_MODE_EXEC_GRAMMAR },
	},
} as const;

test("Code Mode registers native freeform exec beside function controls", () => {
	const registered: Array<{ name: string; constrainedSampling?: unknown }> = [];
	registerPublicCodeModeTools({
		events: {
			emit() {},
			on() { return () => {}; },
		},
		on() {},
		registerTool(tool: { name: string; constrainedSampling?: unknown }) {
			registered.push(tool);
		},
	} as never, {} as never);
	assert.deepEqual(registered
		.filter(({ name }) => name === "exec" || name === "wait")
		.map(({ name, constrainedSampling }) => [name, constrainedSampling]), [
		["exec", exec.constrainedSampling],
		["wait", undefined],
	]);

	const tools = convertResponsesTools([
		exec,
		{
			name: "wait",
			description: "Wait",
			parameters: {
				type: "object",
				properties: { cell_id: { type: "string" } },
				required: ["cell_id"],
			},
		},
	] as never, { supportsOpenAIGrammarTools: true });

	assert.equal(tools[0]?.type, "custom");
	assert.equal((tools[0] as { format: { syntax: string } }).format.syntax, "lark");
	assert.equal("parameters" in tools[0]!, false);
	assert.equal(tools[1]?.type, "function");
	assert.equal(convertResponsesTools([exec] as never)[0]?.type, "function");
});

test("native grammar metadata controls custom replay and function fallback", () => {
	const model = {
		id: "gpt-5.6",
		provider: "openai-codex",
		api: "openai-codex-responses",
		input: ["text"],
		reasoning: true,
	} as never;
	const context = {
		messages: [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call_1|ctc_1", name: "exec", arguments: { code: "text(42);" }, namespace: "security" }],
				provider: "openai-codex",
				api: "openai-codex-responses",
				model: "gpt-5.6",
				stopReason: "toolUse",
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "call_1|ctc_1",
				toolName: "exec",
				content: [{ type: "text", text: "42" }],
				isError: false,
				timestamp: 2,
			},
		],
	} as never;

	assert.deepEqual(
		convertResponsesMessages(model, context, new Set(["openai-codex"]), {
			grammarToolInputProperties: new Map([["exec", "code"]]),
		}),
		[
			{ type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "text(42);", namespace: "security" },
			{ type: "custom_tool_call_output", call_id: "call_1", output: "42" },
		],
	);
	const legacyFunctionContext = {
		messages: [
			{
				content: [{ type: "toolCall", id: "call_1|fc_1", name: "exec", arguments: { code: "text(42);" } }],
				role: "assistant",
				provider: "openai-codex",
				api: "openai-codex-responses",
				model: "gpt-5.6",
				stopReason: "toolUse",
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "call_1|fc_1",
				toolName: "exec",
				content: [{ type: "text", text: "42" }],
				isError: false,
				timestamp: 2,
			},
		],
	} as never;
	assert.deepEqual(
		convertResponsesMessages(model, legacyFunctionContext, new Set(["openai-codex"]), {
			grammarToolInputProperties: new Map([["exec", "code"]]),
		}),
		[
			{ type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "text(42);" },
			{ type: "custom_tool_call_output", call_id: "call_1", output: "42" },
		],
	);
	assert.deepEqual(
		convertResponsesMessages(model, context, new Set(["openai-codex"])),
		[
			{ type: "function_call", call_id: "call_1", name: "exec", arguments: JSON.stringify({ code: "text(42);" }), namespace: "security" },
			{ type: "function_call_output", call_id: "call_1", output: "42" },
		],
	);
	const encryptedHistory = {
		messages: [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "history_call|fc_history", name: "history", namespace: "history", arguments: { action: "list_windows" } }],
				provider: "openai-codex",
				api: "openai-codex-responses",
				model: "gpt-5.6",
				stopReason: "toolUse",
				timestamp: 3,
			},
			{
				role: "toolResult",
				toolCallId: "history_call|fc_history",
				toolName: "history",
				content: [
					{ type: "text", text: "history operation completed" },
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png", detail: "high" },
				],
				details: { codexHistoryNotes: { encrypted_output: "encrypted-history" } },
				isError: false,
				timestamp: 4,
			},
		],
	} as never;
	assert.deepEqual(
		convertResponsesMessages(
			{
				...(model as unknown as Record<string, unknown>),
				input: ["text", "image"],
			} as never,
			encryptedHistory,
			new Set(["openai-codex"]),
		),
		[
			{ type: "function_call", id: "fc_history", call_id: "history_call", name: "list_windows", arguments: "{}", namespace: "history" },
			{
				type: "function_call_output",
				call_id: "history_call",
				output: [
					{ type: "encrypted_content", encrypted_content: "encrypted-history" },
					{ type: "input_image", detail: "high", image_url: "data:image/png;base64,aW1hZ2U=" },
				],
			},
		],
	);
});

test("cross-provider replay keeps deterministic type-correct item IDs", () => {
	const messages = (provider: string, api: string) => [
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call_switch|ctc_source", name: "exec", arguments: { code: "text(42);" } }],
			provider,
			api,
			model: "gpt-5.6",
			stopReason: "toolUse",
			timestamp: 1,
		},
		{
			role: "toolResult",
			toolCallId: "call_switch|ctc_source",
			toolName: "exec",
			content: [{ type: "text", text: "42" }],
			isError: false,
			timestamp: 2,
		},
	] as never;
	const grammarToolInputProperties = new Map([["exec", "code"]]);
	const cases = [
		{
			target: { id: "gpt-5.6", provider: "openai-codex", api: "openai-codex-responses", input: ["text"] },
			source: { provider: "litellm", api: "openai-responses" },
		},
		{
			target: { id: "gpt-5.6", provider: "litellm", api: "openai-responses", input: ["text"] },
			source: { provider: "openai-codex", api: "openai-codex-responses" },
		},
	];

	for (const { target, source } of cases) {
		const context = { messages: messages(source.provider, source.api), tools: [exec] } as never;
		const first = buildRequestBody(target as never, context, { grammarToolInputProperties } as never);
		const second = buildRequestBody(target as never, context, { grammarToolInputProperties } as never);
		const call = first.input.find((item) => (item as { type?: string }).type === "custom_tool_call") as { id: string };
		assert.match(call.id, /^ctc_/);
		assert.notEqual(call.id, "ctc_source");
		assert.deepEqual(second.input, first.input);
		assert.equal(first.input.some((item) => (item as { type?: string }).type === "custom_tool_call_output"), true);
	}

	const functionBody = buildRequestBody(cases[0]!.target as never, {
		messages: messages("litellm", "openai-responses"),
		tools: [exec],
	} as never);
	const functionCall = functionBody.input.find((item) => (item as { type?: string }).type === "function_call") as { id: string };
	assert.match(functionCall.id, /^fc_/);
});
