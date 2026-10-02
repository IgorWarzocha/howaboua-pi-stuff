import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { CODE_MODE_EXEC_GRAMMAR } from "../src/tools/code-mode/exec-contract.ts";
import {
	convertResponsesMessages,
} from "../src/providers/openai-responses/shared.ts";
import { buildRequestBody } from "../src/providers/openai-codex/request-body.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";

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

test("recorded custom origin survives removed or changed declarations while legacy function replay stays compatible", () => {
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
			{ type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "text(42);", namespace: "security" },
			{ type: "custom_tool_call_output", call_id: "call_1", output: "42" },
		],
	);
	assert.deepEqual(convertResponsesMessages(model, context, new Set(["openai-codex"]), {
		grammarToolInputProperties: new Map([["exec", "replacement"]]),
	}), convertResponsesMessages(model, context, new Set(["openai-codex"])), "active schemas cannot reinterpret recorded input or receipt bytes");
	const explicitOrigin = JSON.parse(JSON.stringify(context));
	explicitOrigin.messages[0].content[0].id = "call_1|";
	explicitOrigin.messages[0].content[0].responsesCustomInputProperty = "code";
	explicitOrigin.messages[1].toolCallId = "call_1|";
	assert.deepEqual(convertResponsesMessages(model, explicitOrigin, new Set(["openai-codex"])), [
		{ type: "custom_tool_call", call_id: "call_1", name: "exec", input: "text(42);", namespace: "security" },
		{ type: "custom_tool_call_output", call_id: "call_1", output: "42" },
	], "recorded native provenance survives JSON restoration even without a provider item ID");
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

test("Responses replay keeps cross-provider IDs and clears model-bound IDs", () => {
	const messages = (provider: string, api: string, itemId = "ctc_source") => [
		{
			role: "assistant",
			content: [{ type: "toolCall", id: `call_switch|${itemId}`, name: "exec", arguments: { code: "text(42);" } }],
			provider,
			api,
			model: "gpt-5.6",
			stopReason: "toolUse",
			timestamp: 1,
		},
		{
			role: "toolResult",
			toolCallId: `call_switch|${itemId}`,
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
		const context = normalizeContext({ messages: messages(source.provider, source.api), tools: [exec] } as never);
		const first = buildRequestBody(target as never, context, { grammarToolInputProperties } as never);
		const second = buildRequestBody(target as never, context, { grammarToolInputProperties } as never);
		const call = first.input.find((item) => (item as { type?: string }).type === "custom_tool_call") as { id: string };
		assert.match(call.id, /^ctc_/);
		assert.notEqual(call.id, "ctc_source");
		assert.deepEqual(second.input, first.input);
		assert.deepEqual(serializeMessagesToResponsesInput(target as never, messages(source.provider, source.api), {
			grammarToolInputProperties,
		}), first.input);
		assert.equal(first.input.some((item) => (item as { type?: string }).type === "custom_tool_call_output"), true);
	}

	const [firstCase] = cases;
	assert.ok(firstCase);
	const functionBody = buildRequestBody(firstCase.target as never, normalizeContext({
		messages: messages("litellm", "openai-responses", "fc_source"),
		tools: [exec],
	} as never));
	const functionCall = functionBody.input.find((item) => (item as { type?: string }).type === "function_call") as { id: string };
	assert.match(functionCall.id, /^fc_/);

	for (const grammar of [grammarToolInputProperties, undefined]) {
		const switched: ReturnType<typeof buildRequestBody> = buildRequestBody({ ...firstCase.target, id: "gpt-5.6-luna" } as never, normalizeContext({
			messages: messages("openai-codex", "openai-codex-responses"),
			tools: [exec],
		} as never), { grammarToolInputProperties: grammar });
		const call = switched.input.find((item) => item !== null && typeof item === "object" && "type" in item
			&& (item.type === "custom_tool_call" || item.type === "function_call"));
		assert.ok(call && typeof call === "object");
		assert.equal("id" in call, false, "model switches must not replay reasoning-bound tool item IDs");
	}
	const wrongPrefix = buildRequestBody(firstCase.target as never, normalizeContext({
		messages: messages("openai-codex", "openai-codex-responses", "wrong_source"),
		tools: [exec],
	} as never), { grammarToolInputProperties });
	const customCall = wrongPrefix.input.find((item) => item !== null && typeof item === "object" && "type" in item
		&& item.type === "custom_tool_call");
	assert.ok(customCall && typeof customCall === "object");
	assert.equal("id" in customCall, false, "custom replay must not send an item ID with another type's prefix");
});
