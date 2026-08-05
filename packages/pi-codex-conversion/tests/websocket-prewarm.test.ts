import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { createCodexExtensionRuntime } from "../src/extension/runtime.ts";
import { prewarmOpenAICodexWebSocket } from "../src/providers/openai-codex-custom-provider.ts";
import { isWebSocketSseFallbackActive, recordWebSocketSseFallback } from "../src/providers/openai-codex/websocket.ts";
import {
	ScriptedWebSocket,
	codeModeTools,
	collectStream,
	createRegisteredCodexProvider,
	exampleTool,
	installScriptedWebSocket,
	websocketSuccess,
} from "./openai-codex-test-support.ts";
import {
	type ResponseCreateFrame,
	apiKey,
	context,
	model,
	sentFrames,
	streamOptions,
	unfinishedResponse,
	user,
} from "./websocket-test-support.ts";

test("transport reset preserves session-sticky SSE until shutdown", () => {
	const runtime = createCodexExtensionRuntime({ sendUserMessage: () => undefined } as never);
	const sessionId = "sticky-reset";
	recordWebSocketSseFallback(sessionId);
	runtime.resetTransport(sessionId);
	assert.equal(isWebSocketSseFallbackActive(sessionId), true);
	runtime.shutdownTransport(sessionId);
	assert.equal(isWebSocketSseFallbackActive(sessionId), false);
});

test("post-compaction transport reset restores WebSocket eligibility", () => {
	const runtime = createCodexExtensionRuntime({ sendUserMessage: () => undefined } as never);
	const sessionId = "sticky-compaction-reset";
	recordWebSocketSseFallback(sessionId);
	runtime.resetTransportAfterCompaction(sessionId);
	assert.equal(isWebSocketSseFallbackActive(sessionId), false);
});

test("prewarm refreshes only when its prompt or active tools change", async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		websocketSuccess,
		websocketSuccess,
		websocketSuccess,
	]]);
	try {
		let activeTools = ["exec", "wait"];
		const runtime = createCodexExtensionRuntime({
			getActiveTools: () => activeTools,
			getAllTools: () => [...codeModeTools, exampleTool],
			getThinkingLevel: () => "low",
			sendUserMessage: () => undefined,
		} as never);
		runtime.state.config = {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: true },
		};
		const extensionContext = {
			model,
			modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey }) },
			sessionManager: { getSessionId: () => "prewarm-key" },
		} as never;

		await runtime.startPrewarm(extensionContext, "Prompt A", true);
		await runtime.startPrewarm(extensionContext, "Prompt A", true);
		assert.equal(ScriptedWebSocket.sentFrames.length, 1);

		activeTools = ["exec", "wait", "example_tool"];
		await runtime.startPrewarm(extensionContext, "Prompt A", true);
		await runtime.startPrewarm(extensionContext, "Prompt B", true);
		assert.equal(ScriptedWebSocket.sentFrames.length, 3);
	} finally {
		restoreWebSocket();
	}
});

test("aborted prewarm cleanup cannot clear a newer equivalent operation", async () => {
	const authRequests = [
		Promise.withResolvers<any>(),
		Promise.withResolvers<any>(),
	];
	let authIndex = 0;
	const runtime = createCodexExtensionRuntime({
		getActiveTools: () => ["exec", "wait"],
		getAllTools: () => codeModeTools,
		getThinkingLevel: () => "low",
		sendUserMessage: () => undefined,
	} as never);
	runtime.state.config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: true },
	};
	const extensionContext = {
		model,
		modelRegistry: {
			getApiKeyAndHeaders: () => authRequests[authIndex++]!.promise,
		},
		sessionManager: { getSessionId: () => "equivalent-prewarm" },
	} as never;

	const stale = runtime.startPrewarm(extensionContext, "Prompt", true)!;
	await Promise.resolve();
	runtime.resetTransport("equivalent-prewarm");
	const current = runtime.startPrewarm(extensionContext, "Prompt", true)!;
	await Promise.resolve();
	authRequests[0]!.resolve({ ok: true, apiKey: "" });
	await stale;

	assert.equal(runtime.startPrewarm(extensionContext, "Prompt", true), current);
	authRequests[1]!.resolve({ ok: true, apiKey: "" });
	await current;
});

test("unfinished WebSocket prewarm cannot seed a continuation", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		unfinishedResponse("resp_prewarm_pending", "queued"),
		websocketSuccess,
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "unfinished-prewarm";
		const requestContext = context([user("same user", 1)]);
		await assert.rejects(
			prewarmOpenAICodexWebSocket(
				model as never,
				requestContext as never,
				streamOptions(sessionId) as never,
				{
					getConfig: () => ({
						openai: DEFAULT_CODEX_CONVERSION_CONFIG.openai,
						beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: true },
					}),
					turnState: registered.turnState,
				},
			),
		);

		await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal((sentFrames()[0] as ResponseCreateFrame & { generate?: boolean }).generate, false);
		assert.equal(sentFrames()[1]?.previous_response_id, undefined);
	} finally {
		restoreWebSocket();
	}
});
