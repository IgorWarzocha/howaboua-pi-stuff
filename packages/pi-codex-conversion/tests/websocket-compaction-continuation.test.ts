import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import {
	canonicalCompactionPromptInput,
	captureCanonicalSessionToken,
	clearCanonicalSessions,
	recordCanonicalSessionResponse,
} from "../src/providers/openai-codex/session-continuity.ts";
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
	doneMessage,
	model,
	sentFrames,
	streamOptions,
	textResponse,
	user,
} from "./websocket-test-support.ts";

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

test("V2 compaction exactly replays the provider baseline after its WebSocket dies", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		[(socket) => {
			textResponse("resp_1", "first")(socket);
			socket.emit("close", { code: 1000, reason: "server retired connection" });
		}],
		[compactionResponse("resp_compact")],
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "compaction-reconnect";
		const firstUser = user("first user", 1);
		const firstAssistant = doneMessage(await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser]) as never,
			streamOptions(sessionId) as never,
		)));
		const firstRequest = sentFrames()[0]!;
		const liveTail = user("live tail", 2);
		const rebuiltInput = serializeMessagesToResponsesInput(model, [firstUser, firstAssistant as AgentMessage, liveTail], {
			grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS,
		});
		const canonicalInput = canonicalCompactionPromptInput(sessionId, model.id, undefined, rebuiltInput);
		assert.ok(canonicalInput);

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
			context: context([], "Changed instructions", [] as never),
			promptInput: canonicalInput as never,
			promptInputSource: "canonical",
			requestOptions: { reasoning: { effort: "high", summary: "auto" }, text: { verbosity: "high" } },
			tokensBefore: 1_000,
			sessionId,
			retryDelayMs: 0,
		});

		assert.equal(compactResult.ok, true);
		assert.equal(ScriptedWebSocket.opened, 2);
		const compactionRequest = sentFrames()[1]!;
		assert.equal(compactionRequest.previous_response_id, undefined);
		const firstBody = firstRequest as Record<string, unknown>;
		const compactionBody = compactionRequest as Record<string, unknown>;
		const {
			input: _firstInput,
			client_metadata: _firstMetadata,
			reasoning: _firstReasoning,
			text: _firstText,
			...firstHistoryProperties
		} = firstBody;
		const {
			input: _compactInput,
			client_metadata: _compactMetadata,
			reasoning: compactReasoning,
			text: compactText,
			...compactionHistoryProperties
		} = compactionBody;
		assert.deepEqual(compactionHistoryProperties, firstHistoryProperties);
		assert.deepEqual(compactReasoning, { effort: "high", summary: "auto", context: "all_turns" });
		assert.deepEqual(compactText, { verbosity: "high" });
		assert.deepEqual(compactionRequest.input?.slice(0, firstRequest.input?.length), firstRequest.input);
		assert.deepEqual(compactionRequest.input?.slice(-3), [
			{
				id: "msg_resp_1",
				type: "message",
				status: "completed",
				content: [{ type: "output_text", annotations: [], logprobs: [], text: "first" }],
				phase: "final_answer",
				role: "assistant",
				internal_chat_message_metadata_passthrough: { turn_id: "turn_resp_1" },
			},
			{ role: "user", content: [{ type: "input_text", text: "live tail" }] },
			{ type: "compaction_trigger" },
		]);
		assert.doesNotMatch(JSON.stringify(compactionRequest.input), /Changed instructions/);
	} finally {
		restoreWebSocket();
	}
});

test("an explicit reset rejects a late canonical response from the old lane", () => {
	const sessionId = "reset-generation";
	const token = captureCanonicalSessionToken(sessionId);
	clearCanonicalSessions(sessionId);
	recordCanonicalSessionResponse({
		sessionId,
		url: "wss://example.test/responses",
		accountId: "account",
		requestBody: { model: "model", input: [{ role: "user", content: "stale" }] } as never,
		responseItems: [{ type: "message", role: "assistant", content: [] }],
		token,
	});

	assert.equal(canonicalCompactionPromptInput(sessionId, "model"), undefined);
	clearCanonicalSessions(sessionId);
});
