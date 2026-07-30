import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isRetryableAssistantError, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { captureActiveProviderSystemPrompt, rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { executeRemoteCompactionV2 } from "../src/adapter/compaction/remote-v2-client.ts";
import { getActiveToolsInActiveOrder } from "../src/adapter/active-tools.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { NATIVE_COMPACTION_SHIM_SUMMARY, NATIVE_COMPACTION_STRATEGY } from "../src/adapter/compaction/types.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../src/tools/code-mode/exec-contract.ts";
import { closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket } from "../src/providers/openai-codex-custom-provider.ts";
import { createCodexExtensionRuntime } from "../src/extension/runtime.ts";
import {
	ScriptedWebSocket,
	codeModeTools,
	codexModel,
	collectStream,
	createRegisteredCodexProvider,
	exampleTool,
	fakeJwt,
	installScriptedWebSocket,
	sseResponse,
	websocketSuccess,
} from "./openai-codex-test-support.ts";

type ResponseCreateFrame = {
	type: "response.create";
	input?: unknown[] | undefined;
	previous_response_id?: string | undefined;
};

const model = {
	...(codexModel as object),
	id: "gpt-5.6-luna",
	baseUrl: "https://chatgpt.example/backend-api",
} as Model<any>;

const apiKey = fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } });

function user(text: string, timestamp: number): AgentMessage {
	return { role: "user", content: text, timestamp } as AgentMessage;
}

function textResponse(responseId: string, text: string) {
	return (socket: ScriptedWebSocket) => {
		const item = {
			id: `msg_${responseId}`,
			type: "message",
			status: "completed",
			content: [{ type: "output_text", annotations: [], logprobs: [], text }],
			phase: "final_answer",
			role: "assistant",
			internal_chat_message_metadata_passthrough: { turn_id: `turn_${responseId}` },
		};
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({ type: "response.output_item.done", output_index: 0, item });
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status: "completed", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } },
		});
	};
}

function customToolResponse(responseId: string) {
	return (socket: ScriptedWebSocket) => {
		const item = {
			id: `ctc_${responseId}`,
			type: "custom_tool_call",
			status: "completed",
			call_id: `call_${responseId}`,
			input: 'text("tool result")',
			name: "exec",
			internal_chat_message_metadata_passthrough: { turn_id: `turn_${responseId}` },
		};
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({ type: "response.output_item.done", output_index: 0, item });
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status: "completed", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } },
		});
	};
}

function compactionResponse(responseId: string) {
	return (socket: ScriptedWebSocket) => {
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({
			type: "response.output_item.done",
			output_index: 0,
			item: {
				id: `cmp_${responseId}`,
				type: "compaction",
				encrypted_content: "sealed",
				internal_chat_message_metadata_passthrough: { turn_id: `turn_${responseId}` },
			},
		});
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status: "completed", usage: { input_tokens: 100, output_tokens: 2, total_tokens: 102 } },
		});
	};
}

function failAfterStart(socket: ScriptedWebSocket) {
	socket.emitJson({ type: "response.created", response: { id: "resp_failed" } });
	socket.emit("error", { error: new Error("socket reset by peer") });
}

function apiFailAfterStart(socket: ScriptedWebSocket) {
	socket.emitJson({ type: "response.created", response: { id: "resp_failed" } });
	socket.emitJson({ type: "error", code: "server_error", message: "internal server error" });
}

function missingContinuationAfterStart(socket: ScriptedWebSocket) {
	socket.emitJson({ type: "response.created", response: { id: "resp_missing" } });
	socket.emitJson({ type: "error", code: "previous_response_not_found", message: "previous response not found" });
}

function missingContinuationBeforeStart(socket: ScriptedWebSocket) {
	socket.emitJson({ type: "error", code: "previous_response_not_found", message: "previous response not found" });
}

function unfinishedResponse(responseId: string, status: "queued" | "in_progress") {
	return (socket: ScriptedWebSocket) => {
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
		});
	};
}

function streamOptions(sessionId: string) {
	return {
		apiKey,
		transport: "websocket-cached" as const,
		sessionId,
		reasoning: "low" as const,
		textVerbosity: "low",
	};
}

function context(messages: AgentMessage[], systemPrompt = "Stable instructions", tools = codeModeTools): Context {
	return { systemPrompt, messages: messages as Context["messages"], tools };
}

function doneMessage(events: unknown[]): AssistantMessage {
	const done = events.find((event) => (event as { type?: string }).type === "done") as { message?: AssistantMessage } | undefined;
	assert.ok(done?.message, "provider stream must finish with an assistant message");
	return done.message;
}

function sentFrames(): ResponseCreateFrame[] {
	return ScriptedWebSocket.sentFrames as ResponseCreateFrame[];
}

test("Code Mode normal turns and V2 compaction share one exact WebSocket continuation", async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		customToolResponse("resp_tool"),
		textResponse("resp_1", "first"),
		textResponse("resp_2", "second"),
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
		let captureNextProviderPrompt = true;
		const registered = createRegisteredCodexProvider({
			codeMode: true,
			onPreparedPayload: (payload) => {
				if (!captureNextProviderPrompt) return;
				captureActiveProviderSystemPrompt(payload, promptState);
				captureNextProviderPrompt = false;
			},
		});
		const sessionId = "shared-continuation";
		const activeTurnOptions = {
			...streamOptions(sessionId),
			onPayload: (body: unknown) => ({ ...(body as object), instructions: downstreamPrompt }),
		};
		const firstUser = user("first user", 1);
		const toolCallAssistant = doneMessage(await collectStream(
				registered.provider.streamSimple(model as never, context([firstUser], "Stable instructions", activeTools) as never, activeTurnOptions as never),
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
		const firstMessages = [firstUser, toolCallAssistant as AgentMessage, toolResult];
		const firstAssistant = doneMessage(await collectStream(
				registered.provider.streamSimple(model as never, context(firstMessages, "Stable instructions", activeTools) as never, activeTurnOptions as never),
		));
		const secondUser = user("second user", 2);
		const messages = [...firstMessages, firstAssistant as AgentMessage, secondUser];
		const secondAssistant = doneMessage(await collectStream(
				registered.provider.streamSimple(model as never, context(messages, "Stable instructions", activeTools) as never, activeTurnOptions as never),
		));
		const completeHistory = [...messages, secondAssistant as AgentMessage];
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
			promptInput: serializeMessagesToResponsesInput(model, completeHistory, {
				grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS,
			}),
			requestOptions: { reasoning: { effort: "low", summary: "auto" }, text: { verbosity: "low" } },
			sessionId,
			retryDelayMs: 0,
		});

		assert.equal(compactResult.ok, true);
		assert.equal(promptState.activeProviderSystemPrompt, downstreamPrompt);
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(sentFrames().length, 4);
		assert.equal(sentFrames()[0]?.previous_response_id, undefined);
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_tool");
		assert.deepEqual(sentFrames()[1]?.input, [{
			type: "custom_tool_call_output",
			call_id: "call_resp_tool",
			output: "tool result",
		}]);
		assert.equal(sentFrames()[2]?.previous_response_id, "resp_1");
		assert.deepEqual(sentFrames()[2]?.input, [{ role: "user", content: [{ type: "input_text", text: "second user" }] }]);
		assert.equal(sentFrames()[3]?.previous_response_id, "resp_2");
		assert.deepEqual(sentFrames()[3]?.input, [
			{ type: "compaction_trigger" },
		]);
	} finally {
		restoreWebSocket();
	}
});

test("cache continuation rejects meaningful prompt, tool, and persisted-history rewrites", async () => {
	const cases: Array<{
		name: string;
		mutate: (base: { systemPrompt: string; tools: typeof codeModeTools; messages: AgentMessage[] }) => void;
	}> = [
		{
			name: "system prompt",
			mutate: (base) => { base.systemPrompt = "Changed instructions"; },
		},
		{
			name: "tool schema",
			mutate: (base) => {
				base.tools = structuredClone(codeModeTools) as typeof codeModeTools;
				(base.tools[1] as { description: string }).description = "Changed wait contract";
			},
		},
		{
			name: "tool order",
			mutate: (base) => { base.tools = [...codeModeTools].reverse() as typeof codeModeTools; },
		},
		{
			name: "assistant history",
			mutate: (base) => {
				const assistant = structuredClone(base.messages[1]!) as AssistantMessage;
				const text = assistant.content.find((item) => item.type === "text");
				if (text?.type === "text") text.text = "rewritten assistant history";
				base.messages[1] = assistant as AgentMessage;
			},
		},
	];

	for (const candidate of cases) {
		const restoreWebSocket = installScriptedWebSocket([[
			textResponse("resp_base", "stable assistant"),
			textResponse("resp_changed", "changed"),
		]]);
		try {
			const registered = createRegisteredCodexProvider({ codeMode: true });
			const sessionId = `invalidate-${candidate.name}`;
			const firstUser = user("first user", 1);
			const assistant = doneMessage(await collectStream(
				registered.provider.streamSimple(model as never, context([firstUser]) as never, streamOptions(sessionId) as never),
			));
			const base = {
				systemPrompt: "Stable instructions",
				tools: codeModeTools,
				messages: [firstUser, assistant as AgentMessage, user("new user", 2)],
			};
			candidate.mutate(base);
			await collectStream(registered.provider.streamSimple(
				model as never,
				context(base.messages, base.systemPrompt, base.tools) as never,
				streamOptions(sessionId) as never,
			));

			const changedFrame = sentFrames()[1]!;
			assert.equal(changedFrame.previous_response_id, undefined, `${candidate.name} must invalidate continuation`);
			assert.ok((changedFrame.input?.length ?? 0) > 1, `${candidate.name} must be sent in full`);
		} finally {
			restoreWebSocket();
		}
	}
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

test("SSE fallback stays sticky after three post-start WebSocket failures", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		failAfterStart,
		failAfterStart,
		failAfterStart,
	]);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		return sseResponse([
			{
				type: "response.completed",
				response: {
					id: `resp_sse_${fetchCalls}`,
					status: fetchCalls === 1 ? "in_progress" : "completed",
					usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
				},
			},
		]);
	}) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "post-start-retry";
		const requestContext = context([user("same user", 1)]);
		for (let attempt = 0; attempt < 3; attempt++) {
			const failed = await collectStream(
				registered.provider.streamSimple(model as never, requestContext as never, streamOptions(sessionId) as never),
			);
			const failedEvent = failed.at(-1) as { type?: string; error?: AssistantMessage };
			assert.equal(failedEvent.type, "error");
			assert.ok(failedEvent.error);
			assert.equal(isRetryableAssistantError(failedEvent.error), true);
			assert.match(JSON.stringify(failedEvent.error.diagnostics), /socket reset by peer/);
			assert.equal(fetchCalls, 0);
		}

		const unfinishedSse = await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		assert.equal((unfinishedSse.at(-1) as { type?: string }).type, "error");
		assert.match(JSON.stringify(unfinishedSse.at(-1)), /pending result/);
		assert.equal(ScriptedWebSocket.opened, 3);
		assert.equal(fetchCalls, 1);

		await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		assert.equal(ScriptedWebSocket.opened, 3);
		assert.equal(fetchCalls, 2);

		await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));

		assert.equal(ScriptedWebSocket.opened, 3);
		assert.equal(fetchCalls, 3);
		for (const frame of sentFrames()) {
			assert.equal(frame.previous_response_id, undefined);
			assert.deepEqual(frame, sentFrames()[0]);
		}
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("unfinished WebSocket responses cannot seed a continuation", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		unfinishedResponse("resp_pending", "in_progress"),
		textResponse("resp_recovered", "recovered"),
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "unfinished-continuation";
		const requestContext = context([user("same user", 1)]);
		const failed = await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		assert.equal((failed.at(-1) as { type?: string }).type, "error");
		assert.equal(failed.some((event) => (event as { type?: string }).type === "done"), false);
		assert.match(JSON.stringify((failed.at(-1) as { error?: AssistantMessage }).error?.diagnostics), /pending result/);

		await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[1]?.previous_response_id, undefined);
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
						beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: true },
					}),
					turnState: registered.turnState,
				},
			),
			/Responses stream ended with a pending result/,
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

test("post-start API failures also block Pi's automatic replay", async () => {
	const restoreWebSocket = installScriptedWebSocket([apiFailAfterStart]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const failed = await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("charged request", 1)]) as never,
			streamOptions("post-start-api-error") as never,
		));
		const failedEvent = failed.at(-1) as { error?: AssistantMessage };
		assert.ok(failedEvent.error);
		assert.equal(isRetryableAssistantError(failedEvent.error), false);
		assert.match(failedEvent.error.errorMessage ?? "", /cannot be continued/);
		assert.match(JSON.stringify(failedEvent.error.diagnostics), /internal server error/);
	} finally {
		restoreWebSocket();
	}
});

test("missing continuation after stream start cannot trigger an internal full replay", async () => {
	const restoreWebSocket = installScriptedWebSocket([missingContinuationAfterStart]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const failed = await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("do not replay", 1)]) as never,
			streamOptions("post-start-missing-continuation") as never,
		));
		const failedEvent = failed.at(-1) as { error?: AssistantMessage };
		assert.ok(failedEvent.error);
		assert.equal(isRetryableAssistantError(failedEvent.error), false);
		assert.equal(sentFrames().length, 1);
		assert.match(JSON.stringify(failedEvent.error.diagnostics), /previous_response_not_found/);
	} finally {
		restoreWebSocket();
	}
});

test("missing continuation before stream start retries once with full context", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		[textResponse("resp_base", "base"), missingContinuationBeforeStart],
		textResponse("resp_recovered", "recovered"),
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const firstUser = user("first", 1);
		const assistant = doneMessage(await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser]) as never,
			streamOptions("pre-start-missing-continuation") as never,
		)));
		const recovered = await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser, assistant as AgentMessage, user("second", 2)]) as never,
			streamOptions("pre-start-missing-continuation") as never,
		));

		assert.equal((recovered.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[1]?.previous_response_id, "resp_base");
		assert.equal(sentFrames()[2]?.previous_response_id, undefined);
		assert.ok((sentFrames()[2]?.input?.length ?? 0) > 3);
	} finally {
		restoreWebSocket();
	}
});

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
		const activeProviderPrompt = `${runtime.codexSystemPrompt("Stable instructions", extensionContext)}\nACTIVE PROVIDER PROMPT`;
		runtime.state.activeProviderSystemPrompt = activeProviderPrompt;
		await runtime.startCompactionPrewarm(extensionContext);

		branchEntries = [preEntry, compactionEntry, currentEntry] as SessionEntry[];
		const postCompactionMessages = convertToLlm(buildSessionContext(branchEntries).messages);
		await collectStream(registered.provider.streamSimple(
			model as never,
			context(postCompactionMessages as never, activeProviderPrompt, activeTools) as never,
			{
				...streamOptions(sessionId),
				onPayload: (body: unknown) => rewriteCodexProviderRequest(body, extensionContext, runtime.state),
			} as never,
		));

		assert.equal(ScriptedWebSocket.opened, 2);
		const prewarmFrame = sentFrames()[1] as ResponseCreateFrame & { generate?: boolean };
		assert.equal(prewarmFrame.generate, false);
		assert.equal(JSON.stringify(prewarmFrame.input).match(/sealed-checkpoint/g)?.length, 1);
		assert.equal(JSON.stringify(prewarmFrame.input).match(/ACTIVE PROVIDER PROMPT/g)?.length, 1);
		assert.doesNotMatch(JSON.stringify(prewarmFrame.input), /before compaction/);
		assert.equal(sentFrames()[2]?.previous_response_id, "resp_ws");
		assert.deepEqual(sentFrames()[2]?.input, [{ role: "user", content: [{ type: "input_text", text: "after compaction" }] }]);
	} finally {
		restoreWebSocket();
	}
});
