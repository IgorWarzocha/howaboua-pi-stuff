import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { getActiveToolsInActiveOrder } from "../src/adapter/active-tools.ts";
import { executeRemoteCompactionV2 } from "../src/adapter/compaction/remote-v2-client.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { captureActiveProviderSystemPrompt } from "../src/adapter/provider-request.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../src/tools/code-mode/exec-contract.ts";
import {
	ScriptedWebSocket,
	codeModeTools,
	collectStream,
	createRegisteredCodexProvider,
	exampleTool,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import {
	apiKey,
	compactionResponse,
	context,
	customToolResponse,
	doneMessage,
	model,
	sentFrames,
	streamOptions,
	textResponse,
	user,
} from "./websocket-test-support.ts";

test("Code Mode continuation sends only the pending custom-tool output", async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		customToolResponse("resp_tool"),
		textResponse("resp_1", "first"),
	]]);
	try {
		const activeTools = [...codeModeTools, exampleTool] as typeof codeModeTools;
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const options = streamOptions("tool-output-continuation");
		const firstUser = user("first user", 1);
		const toolCallAssistant = doneMessage(await collectStream(
			registered.provider.streamSimple(model as never, context([firstUser], "Stable instructions", activeTools) as never, options as never),
		));
		const toolCall = toolCallAssistant.content.find((item) => item.type === "toolCall");
		assert.equal(toolCall?.type, "toolCall");
		const toolResult = {
			role: "toolResult",
			toolCallId: toolCall!.id,
			toolName: "exec",
			content: [{ type: "text", text: "tool result" }],
			isError: false,
			timestamp: 2,
		} as AgentMessage;
		await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser, toolCallAssistant as AgentMessage, toolResult], "Stable instructions", activeTools) as never,
			options as never,
		));

		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_tool");
		assert.deepEqual(sentFrames()[1]?.input, [{
			type: "custom_tool_call_output",
			call_id: "call_resp_tool",
			output: "tool result",
		}]);
	} finally {
		restoreWebSocket();
	}
});

test("Code Mode continuation sends only the next user turn", async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		textResponse("resp_1", "first"),
		textResponse("resp_2", "second"),
	]]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const options = streamOptions("user-turn-continuation");
		const firstUser = user("first user", 1);
		const firstAssistant = doneMessage(await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser]) as never,
			options as never,
		)));
		await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser, firstAssistant as AgentMessage, user("second user", 2)]) as never,
			options as never,
		));

		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_1");
		assert.deepEqual(sentFrames()[1]?.input, [{ role: "user", content: [{ type: "input_text", text: "second user" }] }]);
	} finally {
		restoreWebSocket();
	}
});

test("V2 compaction reuses the active turn's WebSocket continuation", async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		textResponse("resp_1", "first"),
		compactionResponse("resp_compact"),
	]]);
	try {
		const activeTools = [...codeModeTools, exampleTool] as typeof codeModeTools;
		const rebuiltCompactionTools = getActiveToolsInActiveOrder({
			getActiveTools: () => ["exec", "wait", "example_tool"],
			getAllTools: () => [exampleTool, ...codeModeTools],
		}, true);
		const downstreamPrompt = "Stable instructions\n\nDownstream machine identity";
		const promptState = { activeProviderSystemPrompt: "Stale pre-extension instructions" } as AdapterState;
		const registered = createRegisteredCodexProvider({
			codeMode: true,
			onPreparedPayload: (payload) => captureActiveProviderSystemPrompt(payload, promptState),
		});
		const sessionId = "compaction-continuation";
		const firstUser = user("first user", 1);
		const firstAssistant = doneMessage(await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser], "Stable instructions", activeTools) as never,
			{
				...streamOptions(sessionId),
				onPayload: (body: unknown) => ({ ...(body as object), instructions: downstreamPrompt }),
			} as never,
		)));
		const compactResult = await executeRemoteCompactionV2({
			runtime: {
				provider: model.provider,
				api: model.api,
				apiFamily: model.api,
				model: model.id,
				baseUrl: model.baseUrl!,
				apiKey,
				headers: {},
				currentModel: model,
			},
			modelRegistry: {
				getRegisteredProviderConfig: () => ({ api: model.api, streamSimple: registered.provider.streamSimple }),
			} as never,
			context: context([], promptState.activeProviderSystemPrompt, rebuiltCompactionTools as typeof codeModeTools),
			promptInput: serializeMessagesToResponsesInput(model, [firstUser, firstAssistant as AgentMessage], {
				grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS,
			}),
			requestOptions: { reasoning: { effort: "low", summary: "auto" }, text: { verbosity: "low" } },
			tokensBefore: 1_000,
			sessionId,
			retryDelayMs: 0,
		});

		assert.equal(compactResult.ok, true);
		assert.equal(promptState.activeProviderSystemPrompt, downstreamPrompt);
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_1");
		assert.deepEqual(sentFrames()[1]?.input, [{ type: "compaction_trigger" }]);
	} finally {
		restoreWebSocket();
	}
});
