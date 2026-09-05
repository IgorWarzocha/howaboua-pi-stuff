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
import { CodexContextTreeCoordinator } from "../src/context-management/tree-coordinator.ts";
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
	const contextEntries = () =>
		contextMessages.map((message, index) => ({
			type: "custom_message",
			id: "entry-" + index,
			parentId: index === 0 ? null : "entry-" + (index - 1),
			timestamp: new Date(index).toISOString(),
			customType: message["customType"],
			content: message["content"],
			display: message["display"],
			details: message["details"],
		}));
	const compactionEvent = (branchEntries = contextEntries()) => ({
		reason: "threshold",
		branchEntries,
		preparation: {
			firstKeptEntryId: "default-cut",
			tokensBefore: 240_000,
		},
	}) as never;
	assert.deepEqual(manager.prepareCompaction(compactionEvent(), "remote"), {
		cancel: true,
	});
	const initialEntries = contextEntries();
	assert.equal(
		await manager.startNewWindow(contextPi, ctx, {
			triggerTurn: false,
			mode: "remote",
			trimPreviousWindow: true,
		}),
		true,
	);
	assert.deepEqual(
		manager.prepareCompaction(compactionEvent(initialEntries), "remote"),
		{ cancel: true },
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
		"remote",
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
	const expectedCompaction = {
		compaction: {
			summary: CONTEXT_WINDOW_COMPACTION_SUMMARY,
			firstKeptEntryId: "entry-1",
			tokensBefore: 240_000,
			details: {
				protocol: 1,
				strategy: "codex-context-window",
				windowId: currentWindowId,
			},
		},
	};
	manager.restore(contextEntries() as never);
	assert.deepEqual(manager.prepareCompaction(compactionEvent(), "tree"), {
		cancel: true,
	});
	assert.deepEqual(
		manager.prepareCompaction(compactionEvent(), "local"),
		expectedCompaction,
	);
	assert.deepEqual(
		manager.prepareCompaction(compactionEvent(), "remote"),
		expectedCompaction,
	);
	manager.recordCompaction(expectedCompaction.compaction.details);
	assert.deepEqual(manager.prepareCompaction(compactionEvent(), "remote"), {
		cancel: true,
	});

	const contextBridge = new CodexDeveloperMessageBridge();
	const contextState: AdapterState = {
		enabled: true,
		cwd: "/repo",
		promptSkills: [],
		executionMode: "notebook",
		codexTurnState: createCodexTurnState(),
		developerMessages: contextBridge,
		contextWindows: manager,
		contextTree: new CodexContextTreeCoordinator(manager),
		pendingActiveProviderPromptCapture: true,
		activeProviderSystemPrompt: "",
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			compaction: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
				contextManagement: "remote",
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
			tools: Array<{
				name: string;
				parameters: {
					properties: Record<string, Record<string, unknown>>;
				};
			}>;
		}>;
	};
	assert.deepEqual(contextPayload.input.map(({ role }) => role), ["developer"]);
	assert.deepEqual(
		contextPayload.tools.map(({ type, name }) => [type, name]),
		[["namespace", "history"], ["namespace", "notes"]],
	);
	// Astra rejects either keyword on reserved Remote schemas, independently.
	for (const namespace of contextPayload.tools) {
		for (const operation of namespace.tools) {
			assert.equal(Object.hasOwn(operation.parameters, "additionalProperties"), false);
			for (const property of Object.values(operation.parameters.properties)) {
				assert.equal(Object.hasOwn(property, "minimum"), false);
			}
		}
	}
	const notesWrite = contextPayload.tools[1]!.tools.find(
		(operation) => operation.name === "write_file",
	)!;
	assert.equal(
		notesWrite.parameters.properties["text"]!["encrypted"],
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

	const modeHints = await Promise.all(
		(["local", "tree", "remote"] as const).map(async (mode) => {
			const sent: Array<Record<string, unknown>> = [];
			const windows = new CodexContextWindowManager(
				async (_context, loadedMode) => `hint:${loadedMode}`,
			);
			const pi = {
				sendMessage(message: Record<string, unknown>) {
					sent.push(message);
				},
			} as never;
			windows.ensureInitialized(pi, ctx, true);
			await windows.startNewWindow(pi, ctx, {
				triggerTurn: false,
				mode,
				trimPreviousWindow: mode !== "tree",
			});
			return sent.at(-1)?.["content"];
		}),
	);
	assert.deepEqual(
		modeHints.map((hint) => String(hint).match(/hint:(local|tree|remote)/)?.[1]),
		["local", "tree", "remote"],
	);

});
