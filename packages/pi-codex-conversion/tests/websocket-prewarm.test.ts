import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexExtensionRuntime } from "../src/extension/runtime.ts";
import { prewarmOpenAICodexWebSocket } from "../src/providers/openai-codex-custom-provider.ts";
import type { ResponsesBody } from "../src/providers/openai-codex/types.ts";
import { isWebSocketSseFallbackActive, recordWebSocketSseFallback } from "../src/providers/openai-codex/websocket.ts";
import {
	ScriptedWebSocket,
	codeModeTools,
	collectStream,
	createRegisteredCodexProvider,
	fakeJwt,
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

test("ordinary prewarm reuses a ready lane after final-body capture; keepalive remains isolated", { timeout: 3000 }, async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		(socket) => {
			socket.emitJson({ type: "response.created", response: { id: "resp_authoritative_prewarm" } });
			socket.emitJson({
				type: "response.completed",
				response: { id: "resp_authoritative_prewarm", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
			});
		},
		websocketSuccess,
		websocketSuccess,
	], [websocketSuccess, websocketSuccess]]);
	try {
		const openedHeaders: Record<string, string>[] = [];
		const handshakeOpened = Promise.withResolvers<void>();
		globalThis.WebSocket = class extends ScriptedWebSocket {
			constructor(_url: string, options: { headers: Record<string, string> }) {
				super();
				openedHeaders.push(options.headers);
				this.addEventListener("open", () => handshakeOpened.resolve());
			}
		} as never;
		let refreshedKey = apiKey;
		const runtime = createCodexExtensionRuntime({ sendUserMessage: () => undefined, getThinkingLevel: () => "low" } as never);
		runtime.state.config = {
			...DEFAULT_CODEX_CONVERSION_CONFIG, executionMode: "code",
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, lunaCacheKeepaliveMinutes: 5 },
		};
		const sessionId = "authoritative-final-body";
		const requestModel = {
			...model,
			compat: {
				supportsOpenAIGrammarTools: true,
				supportsMidConvoSystemMessages: true,
				supportsAdditionalTools: true,
			},
		};
		const extensionContext = {
			model: requestModel,
			modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: refreshedKey, headers: { "x-extension": "auth", "x-deleted": "auth" } }) },
			sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
			ui: { notify: () => undefined },
		} as never;
		const lateTool = {
			name: "late_tool",
			description: "Late tool",
			parameters: {
				type: "object",
				properties: { path: { type: "string" }, force: { type: "boolean" } },
				required: ["path"],
			},
		};
		const transcript = normalizeContext({
			messages: [
				{ role: "system", content: "Base", sections: { policy: "<policy>old</policy>" }, toolsAdded: codeModeTools, timestamp: 0 },
				{ role: "user", content: "Continue", timestamp: 1 },
				{ role: "system", content: "", sections: { policy: "<policy>final</policy>" }, toolsAdded: [lateTool], timestamp: 2 },
			] as never,
		});
		const sidecarTranscript = normalizeContext({ systemPrompt: "Sidecar prompt", messages: [] });
		const sidecarBody: ResponsesBody = {
			model: requestModel.id,
			store: false,
			stream: true,
			input: [],
			text: { verbosity: "low" },
			include: [],
			tool_choice: "auto",
			parallel_tool_calls: true,
		};
		const options = streamOptions(sessionId);
		runtime.prepareTurn(extensionContext);
		await runtime.beforeRequestSend(
			requestModel as never,
			sidecarTranscript,
			sidecarBody,
			{ ...options, cacheRetention: "none" } as never,
			true,
		);
		assert.equal(runtime.state.preparedPrompt, undefined);
		assert.equal(sentFrames().length, 0);

		let onPayloadCalls = 0;
		let preparedBody: ResponsesBody | undefined;
		const registered = createRegisteredCodexProvider({
			codeMode: true,
			beforeRequestSend: runtime.beforeRequestSend,
			onPreparedPayload: (payload) => { preparedBody = structuredClone(payload as ResponsesBody); },
		});
		await collectStream(registered.provider.streamSimple(
			requestModel as never,
			transcript,
			{
				...options,
				headers: { "x-extension": "final", "x-deleted": null },
				onPayload: async (body: unknown) => {
					onPayloadCalls++;
					await handshakeOpened.promise;
					assert.equal(sentFrames().length, 0, "handshake overlaps final preparation without sending a prompt or tools");
					return { ...(body as ResponsesBody), client_metadata: { final_hook: "once" } };
				},
			} as never,
		));

		assert.equal(onPayloadCalls, 1);
		assert.ok(preparedBody);
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(sentFrames().length, 2);
		const warmFrame = sentFrames()[0] as ResponseCreateFrame & { generate?: boolean };
		assert.equal(warmFrame.generate, false);
		assert.deepEqual(warmFrame.input, JSON.parse(JSON.stringify(preparedBody.input)));
		assert.equal(warmFrame.client_metadata?.["final_hook"], "once");
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_authoritative_prewarm");
		assert.match(JSON.stringify(warmFrame.input), /Updated system prompt section \\"policy\\".*<policy>final<\/policy>/);
		const lateSchema = (warmFrame.input as Array<{ type?: string; tools?: Array<{ tools?: unknown[] }> }>)
			.flatMap((item) => item.type === "additional_tools" ? (item.tools ?? []).flatMap((tool) => tool.tools ?? []) : [])
			.find((tool) => (tool as { name?: string }).name === "late_tool");
		assert.deepEqual(lateSchema, {
			type: "function",
			name: "late_tool",
			description: "Late tool",
			parameters: lateTool.parameters,
			strict: false,
		});
		const capturedPrompt = structuredClone(runtime.state.preparedPrompt as AdapterState["preparedPrompt"]);
		assert.deepEqual(capturedPrompt?.systemMessage.sections, { policy: "<policy>final</policy>" });

		runtime.finishTurn();
		await runtime.beforeRequestSend(requestModel as never, sidecarTranscript, sidecarBody, options as never, true);
		assert.deepEqual(runtime.state.preparedPrompt, capturedPrompt);
		assert.equal(sentFrames().length, 2);
		assert.equal((await runtime.startKeepalivePrewarm(extensionContext))?.status, "ready");
		assert.equal(ScriptedWebSocket.opened, 2, "keepalive uses an isolated socket");
		assert.deepEqual(sentFrames()[2]?.input, warmFrame.input, "keepalive preserves final hooks without adding raw response items");
		assert.equal(sentFrames()[2]?.client_metadata?.["final_hook"], "once");
		assert.equal(sentFrames()[2]?.previous_response_id, undefined);
		assert.equal(onPayloadCalls, 1);
		assert.equal(openedHeaders[1]?.["x-extension"], "final");
		assert.equal(openedHeaders[1]?.["x-deleted"], undefined);

		runtime.prepareTurn(extensionContext);
		await collectStream(registered.provider.streamSimple(
			requestModel as never,
			normalizeContext({ messages: [...transcript.messages, { role: "user", content: "Next turn", timestamp: 3 }] }),
			{
				...options,
				headers: { "x-extension": "final", "x-deleted": null },
				onPayload: (body: unknown) => {
					onPayloadCalls++;
					return { ...(body as ResponsesBody), client_metadata: { final_hook: "once" } };
				},
			} as never,
		));
		runtime.finishTurn();
		assert.equal(onPayloadCalls, 2);
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames().length, 4, "the second main turn sends no warmup request");
		assert.equal(sentFrames()[3]?.previous_response_id, "resp_ws", "ordinary prewarm preserves the completed response baseline");
		assert.equal(sentFrames()[3]?.input?.length, 1);
		assert.equal((await runtime.startKeepalivePrewarm(extensionContext))?.status, "ready");
		assert.deepEqual(sentFrames()[4]?.input, JSON.parse(JSON.stringify(preparedBody.input)), "skipping warmup still captures the latest finalized body");
		refreshedKey = fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "other_account" } });
		assert.equal((await runtime.startKeepalivePrewarm(extensionContext))?.status, "skipped", "fresh auth must match the captured account");
		refreshedKey = apiKey;
		runtime.state.config.openai.verbosity = "high";
		assert.equal(runtime.startKeepalivePrewarm(extensionContext), undefined, "changed controls invalidate the capture");
		runtime.state.config.openai.verbosity = "low";
		runtime.resetTransport(sessionId);
		assert.equal(runtime.startKeepalivePrewarm(extensionContext), undefined, "reset waits for another finalized request");
	} finally {
		restoreWebSocket();
	}
});

test("stalled auth in an aborted prewarm cannot block a newer equivalent operation", async () => {
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
		executionMode: "code",
	};
	const extensionContext = {
		model,
		modelRegistry: {
			getApiKeyAndHeaders: () => authRequests[authIndex++]!.promise,
		},
		sessionManager: {
			getSessionId: () => "equivalent-prewarm",
			getEntries: () => [],
			getBranch: () => [{ type: "message", id: "system", parentId: null, message: {
				role: "system", content: "Prompt", toolsAdded: codeModeTools, timestamp: 0,
			} }],
		},
	} as never;

	const stale = runtime.startCompactionPrewarm(extensionContext)!;
	await Promise.resolve();
	runtime.resetTransport("equivalent-prewarm");
	const current = runtime.startCompactionPrewarm(extensionContext)!;
	await Promise.resolve();
	assert.equal(authIndex, 2, "replacement must not wait for non-abortable auth lookup");
	assert.equal(runtime.startCompactionPrewarm(extensionContext), current);
	authRequests[0]!.resolve({ ok: true, apiKey: "" });
	await stale;

	assert.equal(runtime.startCompactionPrewarm(extensionContext), current);
	authRequests[1]!.resolve({ ok: true, apiKey: "" });
	await current;
});

test("compaction prewarm accepts renamed Codex routes and deliberately resets sticky SSE", async () => {
	let warmedSocket: ScriptedWebSocket | undefined;
	const warmup = (socket: ScriptedWebSocket) => {
		warmedSocket = socket;
		socket.emitJson({ type: "response.created", response: { id: "resp_cached" } });
		socket.emitJson({
			type: "response.completed",
			response: {
				id: "resp_cached",
				status: "completed",
				usage: {
					input_tokens: 100,
					input_tokens_details: { cached_tokens: 75 },
				},
			},
		});
	};
	const restoreWebSocket = installScriptedWebSocket([[warmup, warmup, warmup], warmup]);
	const sessionId = "history-prewarm-identity";
	try {
		const runtime = createCodexExtensionRuntime({
			getActiveTools: () => ["exec", "wait"],
			getAllTools: () => codeModeTools,
			getThinkingLevel: () => "low",
			getSettings: () => ({}),
			sendUserMessage: () => undefined,
		} as never);
		recordWebSocketSseFallback(sessionId);
		runtime.resetTransport(sessionId);
		assert.equal(isWebSocketSseFallbackActive(sessionId), true);
		runtime.resetTransportAfterCompaction(sessionId);
		assert.equal(isWebSocketSseFallbackActive(sessionId), false);
		runtime.state.config = {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			executionMode: "code",
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, lunaCacheKeepaliveMinutes: 5 },
		};
		const alias = {
			...model,
			provider: "openai-codex-personal",
			baseUrl: "https://codex-proxy.example.com/backend-api",
		};
		runtime.state.executionMode = "code";
		const sections = { mcp_servers: '<mcp_servers>\nMCP servers whose tools are not declared to you. Call the tools of `codemode` servers from codemode scripts.\n- mcp__records (codemode): Lookup\n</mcp_servers>' };
		const history: SessionEntry[] = [{ type: "message", id: "system", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: {
			role: "system", content: "Stable prompt", sections, toolsAdded: codeModeTools, timestamp: 0,
		} }];
		const extensionContext = {
			cwd: "/repo",
			getSystemPrompt: () => "Stable prompt",
			model: alias,
			modelRegistry: {
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey }),
			},
			sessionManager: {
				getEntries: () => [],
				getBranch: () => history,
				getSessionId: () => sessionId,
			},
		} as never;

		assert.deepEqual(await runtime.startCompactionPrewarm(extensionContext), {
			status: "ready",
			usage: {
				inputTokens: 25,
				cachedInputTokens: 75,
				cacheWriteInputTokens: 0,
			},
			socketReused: false,
		});
		assert.match(JSON.stringify(sentFrames()[0]), /mcp__records: Lookup/);
		assert.doesNotMatch(JSON.stringify(sentFrames()[0]), /Call the tools of|\(codemode\)/);
		assert.match(sections.mcp_servers, /\(codemode\)/, "prewarm never rewrites persisted MCP metadata");

		assert.deepEqual(await runtime.startCompactionPrewarm(extensionContext), { status: "ready", socketReused: true });
		assert.equal(sentFrames().length, 1);
		history.push({ type: "message", id: "next", parentId: "system", timestamp: "2026-01-01T00:00:01.000Z", message: user("Next turn", 1) });
		assert.equal((await runtime.startCompactionPrewarm(extensionContext))?.status, "ready");
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_cached");
		assert.equal(sentFrames()[1]?.input?.length, 1, "history-aware warmup sends only the validated extension");
		runtime.state.config.openai.verbosity = "high";
		assert.equal((await runtime.startCompactionPrewarm(extensionContext))?.status, "ready");
		assert.equal(sentFrames()[2]?.previous_response_id, undefined, "changed request settings require a full warmup");
		assert.ok(warmedSocket);
		warmedSocket.close();
		const repaired = await runtime.startCompactionPrewarm(extensionContext);
		assert.equal(repaired?.status, "ready");
		if (repaired?.status !== "ready") throw new Error("dead socket was not repaired");
		assert.equal(repaired.socketReused, false, "past readiness cannot hide a dead socket");
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[3]?.previous_response_id, undefined);
		assert.equal(runtime.startKeepalivePrewarm(extensionContext), undefined, "compaction does not invent an authoritative live prefix");
		sections.mcp_servers = "Unsupported renderer";
		assert.throws(() => runtime.startCompactionPrewarm(extensionContext), /Unsupported Pi MCP server summary/);
		assert.equal(sentFrames().length, 4, "unsupported discovery guidance never reaches prewarm");
	} finally {
		restoreWebSocket();
	}
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
						executionMode: "code",
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
