import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	canonicalCompactionPromptInput,
	captureCanonicalSessionToken,
	clearCanonicalSessions,
	recordCanonicalSessionResponse,
} from "../src/providers/openai-codex/session-continuity.ts";
import { executeRemoteCompactionV2 } from "../src/adapter/compaction/remote-v2-client.ts";
import { resolveCanonicalCompactionReplay } from "../src/adapter/compaction/compaction.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../src/tools/code-mode/exec-contract.ts";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
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

test("V2 compaction exactly replays an image-bearing provider baseline after its WebSocket dies", async () => {
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
		const imageModel = { ...model, input: ["text", "image"] } as typeof model;
		const firstUser = {
			role: "user",
			content: [
				{ type: "text", text: "first user" },
				{
					type: "image",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
					mimeType: "image/png",
				},
			],
			timestamp: 1,
		} as AgentMessage;
		const firstAssistant = doneMessage(await collectStream(registered.provider.streamSimple(
			imageModel as never,
			context([firstUser]) as never,
			streamOptions(sessionId) as never,
		)));
		const firstRequest = sentFrames()[0]!;
		const liveTail = user("live tail", 2);
		const rebuiltInput = serializeMessagesToResponsesInput(imageModel, [firstUser, firstAssistant as AgentMessage, liveTail], {
			grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS,
		});
		const canonicalReplay = await resolveCanonicalCompactionReplay({
			codeMode: true,
			sessionId,
			model: imageModel.id,
			reconstructedInput: rebuiltInput,
		});
		assert.equal(canonicalReplay.decision, "validated");
		const canonicalInput = canonicalReplay.input;
		assert.ok(canonicalInput);

		const compactResult = await executeRemoteCompactionV2({
			runtime: {
				provider: model.provider,
				api: model.api,
				apiFamily: model.api,
				codexTransport: true,
				model: imageModel.id,
				baseUrl: model.baseUrl!,
				apiKey,
				headers: {},
				currentModel: imageModel,
			},
			modelRegistry: {
				getRegisteredProviderConfig: () => undefined,
				getRegisteredNativeProvider: () => registered.provider,
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
