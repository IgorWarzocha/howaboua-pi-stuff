import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import { createHistoryNotesTools } from "../src/context-management/history-notes.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	CONTEXT_WINDOW_COMPACTION_SUMMARY,
} from "../src/context-management/messages.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import { buildRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { codexModel } from "./openai-codex-test-support.ts";

function createContext() {
	return {
		cwd: "/repo",
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6",
			baseUrl: "https://chatgpt.com/backend-api",
			contextWindow: 272_000,
		},
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => "session-context",
		},
		getContextUsage: () => ({
			tokens: 12_000,
			contextWindow: 272_000,
			percent: 4.4,
		}),
		isIdle: () => true,
	} as never;
}

test("context windows preserve rollover and native request semantics", async () => {
	const contextMessages: Array<Record<string, unknown>> = [];
	const contextPi = {
		sendMessage(message: Record<string, unknown>) {
			contextMessages.push(message);
		},
	} as never;
	const manager = new CodexContextWindowManager(
		async () => "Recovered checkpoint",
	);
	const ctx = createContext();
	manager.ensureInitialized(contextPi, ctx, true);
	assert.equal(
		await manager.startNewWindow(contextPi, ctx, {
			triggerTurn: false,
			mode: "hybrid",
		}),
		true,
	);
	assert.equal(contextMessages.length, 2);
	assert.equal(
		contextMessages.every(
			(message) =>
				message["customType"] === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
		),
		true,
	);
	const activeWindow = manager.project(
		[
			{ role: "user", content: "old window", timestamp: 1 },
			...contextMessages.map((message, index) => ({
				...message,
				role: "custom",
				timestamp: index + 2,
			})),
		] as never,
		true,
	);
	assert.equal(activeWindow.length, 1);
	assert.match(
		(activeWindow[0] as { content: string }).content,
		/Recovered checkpoint/,
	);
	const currentWindowId = (
		contextMessages[1]!["details"] as {
			contextManagement: { currentWindowId: string };
		}
	).contextManagement.currentWindowId;
	assert.deepEqual(manager.remaining(ctx), {
		remainingTokens: 243_616,
		windowId: currentWindowId,
		contextWindow: 255_616,
	});
	assert.deepEqual(
		manager.createCompaction({
			branchEntries: contextMessages.map((message, index) => ({
				type: "custom_message",
				id: "entry-" + index,
				parentId: index === 0 ? null : "entry-" + (index - 1),
				timestamp: new Date(index).toISOString(),
				customType: message["customType"],
				content: message["content"],
				display: message["display"],
				details: message["details"],
			})),
			preparation: {
				firstKeptEntryId: "default-cut",
				tokensBefore: 240_000,
			},
		} as never),
		{
			summary: CONTEXT_WINDOW_COMPACTION_SUMMARY,
			firstKeptEntryId: "entry-1",
			tokensBefore: 240_000,
			details: {
				protocol: 1,
				strategy: "codex-context-window",
				windowId: currentWindowId,
			},
		},
	);

	const contextBridge = new CodexDeveloperMessageBridge();
	const contextState: AdapterState = {
		enabled: true,
		cwd: "/repo",
		promptSkills: [],
		executionMode: "notebook",
		codexTurnState: createCodexTurnState(),
		developerMessages: contextBridge,
		contextWindows: manager,
		pendingActiveProviderPromptCapture: true,
		activeProviderSystemPrompt: "",
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			compaction: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
				contextManagement: "hybrid",
			},
		},
	};
	const routerTools = buildRequestBody(codexModel, {
		messages: [],
		tools: createHistoryNotesTools(),
	} as never).tools as Array<{
		name: string;
		parameters: {
			additionalProperties: boolean;
			properties: Record<string, Record<string, unknown>>;
		};
	}>;
	const historyRouter = routerTools.find((tool) => tool.name === "history")!;
	assert.equal(historyRouter.parameters.additionalProperties, false);
	assert.deepEqual(historyRouter.parameters.properties["action"], {
		type: "string",
		enum: ["list_windows", "list_items", "read_item", "search_contents"],
	});

	const contextPayload = await rewriteCodexProviderRequest(
		{
			model: "gpt-5.6",
			tools: routerTools,
			input: contextBridge.prepare(activeWindow, true).map((message) => ({
				role: "user",
				content: [{
					type: "input_text",
					text: (message as { content: string }).content,
				}],
			})),
		},
		ctx,
		contextState,
	) as {
		input: Array<{ role: string }>;
		client_metadata: Record<string, string>;
		tools: Array<{
			type: string;
			name: string;
			parameters: {
				additionalProperties: boolean;
				properties: Record<string, Record<string, unknown>>;
			};
		}>;
	};
	assert.deepEqual(contextPayload.input.map(({ role }) => role), ["developer"]);
	assert.deepEqual(
		contextPayload.tools.map(({ type, name }) => [type, name]),
		[["function", "history"], ["function", "notes"]],
	);
	assert.equal(
		"encrypted" in contextPayload.tools[1]!.parameters.properties["text"]!,
		false,
	);
	assert.equal(
		"action" in contextPayload.tools[1]!.parameters.properties,
		true,
	);
	const metadata = JSON.parse(
		contextPayload.client_metadata["x-codex-turn-metadata"]!,
	) as Record<string, unknown>;
	assert.deepEqual(
		{
			window_id: metadata["window_id"],
			window_number: metadata["window_number"],
			context_window_id: metadata["context_window_id"],
		},
		{
			window_id: "session-context:1",
			window_number: 1,
			context_window_id: currentWindowId,
		},
	);

});
