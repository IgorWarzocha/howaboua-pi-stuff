import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionContext, convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, normalizeContext } from "@earendil-works/pi-ai";
import { buildCachedWebSocketRequestBody, buildRequestBody, type ResponsesBody } from "../src/providers/openai-codex-custom-provider.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { codexReasoningUpdates, flushCodexReasoningUpdates, hasPendingCodexReasoningUpdate, recordCodexReasoningUpdate, normalizeCodexConfigurationUpdates } from "../src/adapter/reasoning-updates.ts";
import { projectCodexDeveloperHistory } from "../src/adapter/developer-history.ts";
import { applyResponsesLiteRequest } from "../src/providers/openai-codex/responses-lite.ts";
import { openAICodexProviderModels } from "../src/providers/openai-codex/model-catalog.ts";
import { serializeActiveSessionToResponsesInput, serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { createAutoReasoning } from "../src/adapter/auto-reasoning.ts";
import { serializeLiveTailToResponsesInput, rewriteResponsesPayloadWithNativeReplay } from "../src/adapter/replay/native-replay-segments.ts";
import { createNativeCompactionDetails, NATIVE_COMPACTION_SHIM_SUMMARY } from "../src/adapter/compaction/types.ts";
import { buildNativeCompactionInput } from "../src/adapter/compaction/compaction.ts";
import { resolveLatestNativeCompactionEntry } from "../src/adapter/compaction/details-store.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { resolveCodexRuntimePlan } from "../src/adapter/activation/runtime-plan.ts";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import { context, doneMessage, model, sentFrames, streamOptions, textResponse, user } from "./websocket-test-support.ts";

test("request reasoning must match; persisted GPT-6 updates extend the input instead", async () => {
	const userInput = { role: "user", content: [{ type: "input_text", text: "first" }] };
	const assistantOutput = { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] };
	const base = {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		input: [userInput],
		text: { verbosity: "low" },
		include: [],
		tool_choice: "auto" as const,
		parallel_tool_calls: false,
		reasoning: { effort: "low" },
	};
	const continuation = { lastRequestBody: base, lastResponseId: "resp_base", lastResponseItems: [assistantOutput] };
	const nextInput = [...base.input, assistantOutput, { role: "user", content: [{ type: "input_text", text: "next" }] }];
	const matching = buildCachedWebSocketRequestBody(continuation, { ...base, input: nextInput });
	assert.equal(matching.decision, "delta");
	assert.equal(matching.body.previous_response_id, "resp_base");
	assert.deepEqual(matching.body.input, nextInput.slice(-1));
	for (const changed of [
		{ ...base, model: "gpt-5.6-sol", input: nextInput },
		{ ...base, reasoning: { effort: "high" }, input: nextInput },
	]) {
		const result = buildCachedWebSocketRequestBody(continuation, changed);
		assert.equal(result.decision, "body_mismatch");
		assert.equal(result.body.previous_response_id, undefined);
		assert.deepEqual(result.body.input, nextInput);
	}

	const fresh = SessionManager.inMemory("/repo");
	const freshModel = { ...model, id: "gpt-6-luna" };
	recordCodexReasoningUpdate({
		getThinkingLevel: () => "high",
		appendEntry: (type: string, data: unknown) => fresh.appendCustomEntry(type, data),
	} as never, { model: freshModel, sessionManager: fresh, isIdle: () => true } as never, [], "medium");
	fresh.appendMessage({ role: "system", content: "Stable instructions", timestamp: 1 });
	fresh.appendMessage(user("hi", 2) as never);
	const initialContext = buildSessionContext(fresh.getBranch()).messages;
	const firstPrompt = projectCodexDeveloperHistory(fresh.getBranch(), initialContext);
	assert.deepEqual(firstPrompt.map((message) => message.role), ["system", "custom", "user"]);
	assert.deepEqual(firstPrompt[0], initialContext[0]);
	assert.equal(codexReasoningUpdates(firstPrompt, freshModel)[0]?.effort, "high");
	const firstBridge = new CodexDeveloperMessageBridge();
	const firstBody = firstBridge.rewritePayload(buildRequestBody(freshModel, normalizeContext({
		systemPrompt: "Stable instructions",
		messages: convertToLlm(firstBridge.prepare(firstPrompt, true, freshModel)),
	}), { reasoning: "high", sessionId: fresh.getSessionId() })) as ResponsesBody;
	assert.equal(firstBody.reasoning?.effort, "medium");
	assert.deepEqual(firstBody.input.at(-2), { type: "configuration_update", reasoning: { effort: "high" } });
	const registeredModels = openAICodexProviderModels();
	for (const id of ["gpt-6-sol", "gpt-6-luna"]) {
		const registeredModel = registeredModels.find((candidate) => candidate.id === id);
		assert.ok(registeredModel);
		assert.equal(registeredModel.thinkingLevelMap?.off, null);
		assert.equal(getSupportedThinkingLevels(registeredModel).includes("off"), false);
	}

	for (const id of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
		const gpt6 = { ...model, id };
		const session = SessionManager.inMemory("/repo");
		let level: "low" | "medium" | "high" = "low";
		let idle = true;
		const pi = {
			getThinkingLevel: () => level,
			setThinkingLevel: (next: typeof level) => {
				const previous = level;
				level = next;
				recordCodexReasoningUpdate(pi, ctx, messages(), previous);
			},
			appendEntry: (type: string, data: unknown) => session.appendCustomEntry(type, data),
		} as never;
		const ctx = { model: gpt6, sessionManager: session, isIdle: () => idle } as never;
		const messages = () => projectCodexDeveloperHistory(session.getBranch());
		const config = structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
		assert.equal(resolveCodexRuntimePlan({ model: gpt6 }, config).autoReasoning, false);
		config.tools.autoReasoning = true;
		for (const executionMode of ["normal", "code", "notebook"] as const) {
			const plan = resolveCodexRuntimePlan({ model: gpt6 }, config, executionMode);
			assert.equal(plan.autoReasoning, true);
			assert.equal(plan.toolNames.some((name) => name === "change_reasoning"), executionMode === "normal");
			assert.equal(resolveCodexRuntimePlan({ model }, config, executionMode).autoReasoning, false);
			assert.equal(resolveCodexRuntimePlan({ model: { ...gpt6, api: "openai-responses" } }, config, executionMode).autoReasoning, false);
		}
		const auto = createAutoReasoning(pi, { config, executionMode: "normal" } as never);
		const build = (bridge = new CodexDeveloperMessageBridge(), lite = true) => {
			const body = buildRequestBody(gpt6, normalizeContext({
				systemPrompt: "Stable instructions",
				messages: convertToLlm(bridge.prepare(messages(), true, gpt6)),
			}), { reasoning: level, sessionId: session.getSessionId() });
			const rewritten = bridge.rewritePayload(body) as ResponsesBody;
			return lite ? applyResponsesLiteRequest(rewritten) : rewritten;
		};
		session.appendMessage(user("first", 1) as never);
		const initial = build();
		session.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], api: gpt6.api, provider: gpt6.provider, model: gpt6.id, stopReason: "stop", timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
		const baseline = build().input;
		auto.begin(ctx);
		idle = false;
		await auto.tool.execute("raise", { level: "high" }, undefined, undefined, ctx);
		auto.begin(ctx); // Retry/compaction does not replace the user floor.
		await auto.tool.execute("lower", { level: "medium" }, undefined, undefined, ctx);
		assert.equal(codexReasoningUpdates(messages(), gpt6).length, 0, "in-flight changes wait for the completed turn");
		flushCodexReasoningUpdates(pi, ctx);
		idle = true;
		assert.equal(session.getBranch().filter((entry) => entry.type === "custom_message").length, 0);
		assert.equal(buildSessionContext(session.getBranch()).messages.length, 2, "bookkeeping stays out of Pi chat/tree context");
		assert.deepEqual(projectCodexDeveloperHistory(session.getBranch(), buildSessionContext(session.getBranch()).messages), messages());
		const persistedCount = session.getBranch().length;
		recordCodexReasoningUpdate(pi, ctx, messages());
		assert.equal(session.getBranch().length, persistedCount);
		assert.equal(hasPendingCodexReasoningUpdate(messages()), true);
		session.appendMessage(user("next", 3) as never);
		const updated = build();
		assert.deepEqual(updated.reasoning, initial.reasoning);
		assert.equal(updated.prompt_cache_key, initial.prompt_cache_key);
		assert.deepEqual(updated.input.slice(0, baseline.length), baseline);
		const update = { type: "configuration_update", reasoning: { effort: "medium" } };
		assert.deepEqual(updated.input.slice(baseline.length, -1), [update]);
		assert.equal(codexReasoningUpdates(messages(), gpt6)[0]?.initialEffort, "low");
		assert.deepEqual(build(), updated, "resume reconstructs native items independently of carrier secrets");
		assert.deepEqual(serializeMessagesToResponsesInput(gpt6, messages()).slice(-2), updated.input.slice(-2));
		assert.deepEqual(serializeActiveSessionToResponsesInput({ model: gpt6, entries: session.getBranch() }).slice(-2), updated.input.slice(-2));
		assert.deepEqual(serializeLiveTailToResponsesInput({ model: gpt6, entries: session.getBranch().slice(2) }).slice(-2), updated.input.slice(-2));
		const result = buildCachedWebSocketRequestBody({ lastRequestBody: initial, lastResponseId: "low_response", lastResponseItems: baseline.slice(initial.input.length) }, updated);
		assert.equal(result.decision, "delta");
		assert.deepEqual(result.body.input, updated.input.slice(baseline.length));
		assert.equal(result.body.previous_response_id, "low_response");
		const beforeCompaction = structuredClone(session.getBranch());
		const details = createNativeCompactionDetails({
			provider: gpt6.provider, api: gpt6.api, model: gpt6.id, baseUrl: gpt6.baseUrl!,
			// Older checkpoints carried the final override. It must not override a new selection.
			compactedWindow: [{ type: "compaction", encrypted_content: "sealed" }, update],
		});
		session.appendCompaction(NATIVE_COMPACTION_SHIM_SUMMARY, beforeCompaction[0]!.id, 1_000, details);
		assert.deepEqual(session.getBranch().slice(0, beforeCompaction.length), beforeCompaction, "compaction projection never edits saved reasoning history");
		assert.equal(codexReasoningUpdates(messages(), gpt6).length, 0, "kept pre-compaction records cannot pin the next request");
		assert.deepEqual(projectCodexDeveloperHistory(session.getBranch(), buildSessionContext(session.getBranch()).messages), messages());
		assert.equal(codexReasoningUpdates(projectCodexDeveloperHistory(session.getBranch(), undefined, beforeCompaction.at(-1)!.id), gpt6).length, 2, "an older leaf still sees its own settings history");
		const rebased = build(undefined, false);
		assert.equal(rebased.reasoning?.effort, "medium");
		const compacted = resolveLatestNativeCompactionEntry(session.getBranch());
		assert.equal(compacted.ok, true);
		const replay = rewriteResponsesPayloadWithNativeReplay({ model: gpt6, payload: rebased, branchEntries: session.getBranch(), compactionEntry: compacted.entry });
		assert.equal(replay.ok, true);
		assert.deepEqual(replay.rewrittenPayload.input, [{ type: "compaction", encrypted_content: "sealed" }]);
		assert.deepEqual(buildNativeCompactionInput({ model: gpt6, branchEntries: session.getBranch(), allEntries: session.getBranch(), latestNativeCompaction: compacted })?.input, replay.rewrittenPayload.input);
		auto.settle(ctx);
		assert.equal(level, "low");
		assert.equal(codexReasoningUpdates(messages(), gpt6).at(-1)?.effort, "low");
		assert.equal(codexReasoningUpdates(messages(), gpt6).at(-1)?.initialEffort, "medium");
		level = "high";
		auto.begin(ctx);
		const floored = await auto.tool.execute("floor", { level: "low" }, undefined, undefined, ctx);
		assert.deepEqual(floored.details, { level: "high", floor: "high" });
		auto.settle(ctx);
		config.tools.autoReasoning = false;
		await assert.rejects(auto.tool.execute("disabled", { level: "low" }, undefined, undefined, ctx), /requires Auto reasoning/);
		assert.throws(() => normalizeCodexConfigurationUpdates({ ...updated, truncation: "auto" }), /automatic truncation/);
		assert.throws(() => normalizeCodexConfigurationUpdates({ ...updated, context_management: [{ type: "compaction" }] }), /automatic compaction/);
		assert.equal(normalizeCodexConfigurationUpdates({ ...updated, model: "gpt-5.6-sol" }).input.some((item: any) => item.type === "configuration_update"), false);
		assert.equal(new CodexDeveloperMessageBridge().prepare(messages(), true, model).some((message) => message.role === "custom"), false);
		level = "high";
		recordCodexReasoningUpdate(pi, ctx, [], "medium");
		assert.equal(codexReasoningUpdates(messages(), gpt6).at(-1)?.initialEffort, "medium", "a fresh projected window must not inherit the previous window's baseline");
		const legacy = { ...codexReasoningUpdates(messages(), gpt6).at(-1)!, id: "legacy-saved", effort: "medium" };
		session.appendCustomMessageEntry("codex-reasoning-update", "Reasoning effort: medium", false, legacy);
		assert.equal(codexReasoningUpdates(messages(), gpt6).at(-1)?.id, legacy.id);
		assert.deepEqual(serializeActiveSessionToResponsesInput({ model: gpt6, entries: session.getBranch() }).at(-1), { type: "configuration_update", reasoning: { effort: "medium" } });
	}
});

test("continuation sends only a pending custom-tool output", () => {
	const userInput = { role: "user", content: [{ type: "input_text", text: "first" }] };
	const requestBody = {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		input: [userInput],
		text: { verbosity: "low" },
		include: [],
		tool_choice: "auto" as const,
		parallel_tool_calls: false,
		reasoning: { effort: "low" },
	};
	const providerToolCall = {
		type: "custom_tool_call",
		id: "ctc_tool",
		call_id: "call_tool",
		name: "exec",
		input: 'text("tool result")',
		status: "completed",
		internal_chat_message_metadata_passthrough: { turn_id: "turn_tool" },
	};
	const reconstructedToolCall = {
		type: "custom_tool_call",
		id: "ctc_tool",
		call_id: "call_tool",
		name: "exec",
		input: 'text("tool result")',
	};
	const toolOutput = { type: "custom_tool_call_output", call_id: "call_tool", output: "tool result" };

	const result = buildCachedWebSocketRequestBody({
		lastRequestBody: requestBody,
		lastResponseId: "resp_tool",
		lastResponseItems: [providerToolCall],
	}, { ...requestBody, input: [userInput, reconstructedToolCall, toolOutput] });

	assert.equal(result.decision, "delta");
	assert.equal(result.body.previous_response_id, "resp_tool");
	assert.deepEqual(result.body.input, [toolOutput]);
});

test("WebSocket continuations never cross session IDs", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		textResponse("resp_session_a", "session A"),
		textResponse("resp_session_b", "session B"),
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const firstUser = user("session A user", 1);
		const assistant = doneMessage(await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser]) as never,
			streamOptions("session-a") as never,
		)));
		await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser, assistant as AgentMessage, user("session B user", 2)]) as never,
			streamOptions("session-b") as never,
		));

		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[1]?.previous_response_id, undefined);
		assert.ok((sentFrames()[1]?.input?.length ?? 0) > 3, "a new session must send its full independent input");
	} finally {
		restoreWebSocket();
	}
});
