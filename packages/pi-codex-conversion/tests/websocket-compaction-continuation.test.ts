import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext } from "@earendil-works/pi-ai";
import {
	canonicalCompactionPromptInput,
	captureCanonicalSessionToken,
	clearCanonicalSessions,
	recordCanonicalSessionResponse,
} from "../src/providers/openai-codex/session-continuity.ts";
import { executeRemoteCompactionV2, type ExecuteRemoteCompactionV2Options } from "../src/adapter/compaction/remote-v2-client.ts";
import { resolveCanonicalCompactionReplay } from "../src/adapter/compaction/compaction.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../src/tools/code-mode/exec-contract.ts";
import { createCodexExtensionRuntime } from "../src/extension/runtime.ts";
import { acquireWebSocket, closeOpenAICodexWebSocketSessions } from "../src/providers/openai-codex/websocket-session-cache.ts";
import { buildWebSocketHeaders, resolveCodexWebSocketUrl } from "../src/providers/openai-codex/headers.ts";
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
		[textResponse("resp_invalid_compact", "not a checkpoint")],
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

		const compactionOptions: ExecuteRemoteCompactionV2Options = {
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
			context: normalizeContext(context([], "Changed instructions", [] as never)),
			promptInput: canonicalInput as never,
			promptInputSource: "canonical",
			requestOptions: { reasoning: { effort: "high", summary: "auto" }, text: { verbosity: "high" } },
			tokensBefore: 1_000,
			sessionId,
			retryDelayMs: 0,
		};
		const baseline = canonicalCompactionPromptInput(sessionId, imageModel.id);
		const invalid = await executeRemoteCompactionV2(compactionOptions);
		assert.equal(invalid.ok, false);
		assert.equal(invalid.reason, "invalid-output");
		assert.deepEqual(canonicalCompactionPromptInput(sessionId, imageModel.id), baseline, "invalid compaction output never replaces the canonical request");
		const compactResult = await executeRemoteCompactionV2(compactionOptions);

		assert.equal(compactResult.ok, true);
		assert.equal(ScriptedWebSocket.opened, 3);
		const compactionRequest = sentFrames()[2]!;
		assert.equal(compactionRequest.previous_response_id, undefined);
		const firstBody = firstRequest as Record<string, unknown>;
		const compactionBody = compactionRequest as Record<string, unknown>;
		const {
			input: _firstInput,
			client_metadata: _firstMetadata,
			reasoning: firstReasoning,
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
		assert.deepEqual(compactReasoning, firstReasoning, "compaction keeps the last request's reasoning, not the newer selector");
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

test("transport reset rejects late responses and pending preparation handshakes", { timeout: 3000 }, async () => {
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

	for (const teardown of ["reset", "shutdown", "all"] as const) {
		const originalWebSocket = globalThis.WebSocket;
		const created = [Promise.withResolvers<DelayedWebSocket>(), Promise.withResolvers<DelayedWebSocket>()];
		let constructions = 0;
		class DelayedWebSocket {
			readyState = 0;
			readonly events = new EventTarget();
			constructor() { created[constructions++]?.resolve(this); }
			addEventListener(type: string, listener: EventListener) { this.events.addEventListener(type, listener); }
			removeEventListener(type: string, listener: EventListener) { this.events.removeEventListener(type, listener); }
			open() {
				if (this.readyState === 3) return;
				this.readyState = 1;
				this.events.dispatchEvent(new Event("open"));
			}
			close() { this.readyState = 3; }
			send() { assert.fail("no payload may be sent while final preparation is blocked"); }
		}
		globalThis.WebSocket = DelayedWebSocket as never;
		const payloadEntered = Promise.withResolvers<void>();
		const payload = Promise.withResolvers<void>();
		const streamController = new AbortController();
		const runtime = createCodexExtensionRuntime({ getThinkingLevel: () => "low", sendUserMessage: () => undefined } as never);
		const preparationSession = `pending-preparation-${teardown}`;
		runtime.prepareTurn({ model, sessionManager: { getSessionId: () => preparationSession } } as never);
		const registered = createRegisteredCodexProvider({ codeMode: true, beforeRequestSend: runtime.beforeRequestSend });
		const stream = collectStream(registered.provider.streamSimple(model as never, normalizeContext(context([user("go", 1)])), {
			...streamOptions(preparationSession), signal: streamController.signal,
			onPayload: async (body: unknown) => { payloadEntered.resolve(); await payload.promise; return body; },
		} as never));
		try {
			const [pending] = await Promise.all([created[0]!.promise, payloadEntered.promise]);
			if (teardown === "reset") runtime.resetTransport(preparationSession);
			else if (teardown === "shutdown") runtime.shutdownTransport(preparationSession);
			else runtime.resetTransport();
			assert.equal(streamController.signal.aborted, false, "session teardown must cancel preparation without relying on stream abort");
			pending.open();
			assert.equal(pending.readyState, 3, "a late open cannot resurrect the retired preparation");

			const replacement = acquireWebSocket(resolveCodexWebSocketUrl(model.baseUrl),
				buildWebSocketHeaders(model.headers, undefined, "acct_1", apiKey, preparationSession), preparationSession, "acct_1", undefined);
			const nextSocket = await created[1]!.promise;
			nextSocket.open();
			const acquired = await replacement;
			assert.equal(acquired.reused, false, "the new lane must not retain pre-reset preparation state");
			assert.notEqual(acquired.socket, pending);
			acquired.release({ keep: false });
		} finally {
			streamController.abort();
			payload.resolve();
			await stream;
			closeOpenAICodexWebSocketSessions(preparationSession);
			globalThis.WebSocket = originalWebSocket;
		}
	}
});
