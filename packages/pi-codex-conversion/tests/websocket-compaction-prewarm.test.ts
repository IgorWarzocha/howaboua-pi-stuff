import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionContext, convertToLlm, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { NATIVE_COMPACTION_SHIM_SUMMARY, NATIVE_COMPACTION_STRATEGY } from "../src/adapter/compaction/types.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import { createCodexExtensionRuntime } from "../src/extension/runtime.ts";
import { closeOpenAICodexWebSocketSessions } from "../src/providers/openai-codex-custom-provider.ts";
import {
	ScriptedWebSocket,
	codeModeTools,
	collectStream,
	createRegisteredCodexProvider,
	exampleTool,
	installScriptedWebSocket,
	websocketSuccess,
} from "./openai-codex-test-support.ts";
import { type ResponseCreateFrame, apiKey, context, model, sentFrames, streamOptions, textResponse, user } from "./websocket-test-support.ts";

test("post-compaction prewarm opens a fresh socket with the encrypted checkpoint and makes the next turn delta-only", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		textResponse("resp_old", "before compaction"),
		[websocketSuccess, textResponse("resp_after", "after compaction")],
	]);
	try {
		const activeTools = [...codeModeTools, exampleTool] as typeof codeModeTools;
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "post-compaction-prewarm";
		await collectStream(registered.provider.streamSimple(
			model as never,
				context([user("before compaction", 1)]) as never,
			streamOptions(sessionId) as never,
		));

		closeOpenAICodexWebSocketSessions(sessionId);
		const compactedWindow = [{ type: "compaction", encrypted_content: "sealed-checkpoint" }];
		const config = {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: true },
			compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, responsesCompaction: true },
		};
		const firstUser = user("before compaction", 1);
		const nextUser = user("after compaction", 2);
		const preEntry = {
			type: "message",
			id: "pre",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: firstUser,
		};
		const compactionEntry = {
			type: "compaction",
			id: "compact",
			parentId: "pre",
			timestamp: new Date(2).toISOString(),
			summary: NATIVE_COMPACTION_SHIM_SUMMARY,
			firstKeptEntryId: "pre",
			tokensBefore: 100,
			details: {
				strategy: NATIVE_COMPACTION_STRATEGY,
				provider: model.provider,
				api: model.api,
				model: model.id,
				baseUrl: model.baseUrl,
				createdAt: new Date(2).toISOString(),
				compactedWindow,
			},
		};
		const currentEntry = {
			type: "message",
			id: "current",
			parentId: "compact",
			timestamp: new Date(3).toISOString(),
			message: nextUser,
		};
		let branchEntries = [preEntry, compactionEntry] as SessionEntry[];
		const extensionContext = {
			model,
			getSystemPrompt: () => "Stable instructions",
			modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey }) },
			sessionManager: {
				getBranch: () => branchEntries,
				getSessionId: () => sessionId,
			},
			ui: { notify: () => undefined },
		} as never;
		const runtime = createCodexExtensionRuntime({
			getActiveTools: () => ["exec", "wait", "example_tool"],
			getAllTools: () => [exampleTool, ...codeModeTools],
			getThinkingLevel: () => "low",
			sendUserMessage: () => undefined,
		} as never);
		runtime.state.config = config;
		const preCompactionPrompt = `${runtime.codexSystemPrompt("Stable instructions", extensionContext)}\nPROMOTED: old_tool`;
		const postCompactionPrompt = preCompactionPrompt.replace("old_tool", "old_tool, late_tool");
		runtime.state.activeProviderSystemPrompt = postCompactionPrompt;
		await runtime.startCompactionPrewarm(extensionContext);

		branchEntries = [preEntry, compactionEntry, currentEntry] as SessionEntry[];
		const postCompactionMessages = convertToLlm(buildSessionContext(branchEntries).messages);
		await collectStream(registered.provider.streamSimple(
			model as never,
			context(postCompactionMessages as never, postCompactionPrompt, activeTools) as never,
			{
				...streamOptions(sessionId),
				onPayload: (body: unknown) => rewriteCodexProviderRequest(body, extensionContext, runtime.state),
			} as never,
		));

		assert.equal(ScriptedWebSocket.opened, 2);
		const prewarmFrame = sentFrames()[1] as ResponseCreateFrame & { generate?: boolean };
		assert.equal(prewarmFrame.generate, false);
		assert.equal(JSON.stringify(prewarmFrame.input).match(/sealed-checkpoint/g)?.length, 1);
		assert.equal(JSON.stringify(prewarmFrame.input).match(/PROMOTED: old_tool, late_tool/g)?.length, 1);
		assert.doesNotMatch(JSON.stringify(prewarmFrame.input), /PROMOTED: old_tool"/);
		assert.doesNotMatch(JSON.stringify(prewarmFrame.input), /before compaction/);
		assert.equal(sentFrames()[2]?.previous_response_id, "resp_ws");
		assert.deepEqual(sentFrames()[2]?.input, [{ role: "user", content: [{ type: "input_text", text: "after compaction" }] }]);
	} finally {
		restoreWebSocket();
	}
});
