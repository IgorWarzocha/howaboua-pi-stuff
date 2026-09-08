import test from "node:test";
import assert from "node:assert/strict";
import type { Api, Model } from "@earendil-works/pi-ai";
import { SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import { createHistoryNotesTools } from "../src/context-management/history-notes.ts";
import { createContextWindowTools } from "../src/context-management/tools.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	CONTEXT_WINDOW_COMPACTION_SUMMARY,
} from "../src/context-management/messages.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import { CodexContextWindowKickoff } from "../src/context-management/window-kickoff.ts";
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
		isProjectTrusted: () => false,
	} as never;
}

test("context windows preserve rollover and native request semantics", async (t) => {
	t.mock.method(SettingsManager, "create", () => SettingsManager.inMemory({ compaction: { reserveTokens: 32_768 } }));
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
	manager.recordBudget(contextPi, ctx, true, 272_000);
	assert.equal(contextMessages.length, 2, "old usage cannot checkpoint the newly scheduled window");
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
		remainingTokens: 227_232,
		windowId: currentWindowId,
		contextWindow: 239_232,
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

	for (const mode of ["local", "tree", "remote"] as const) {
		assert.deepEqual(manager.prepareCompaction(compactionEvent(), mode, true), { cancel: true });
		assert.equal(manager.prepareCompaction({ reason: "manual" } as never, mode, true), undefined);
		const checkpointManager = new CodexContextWindowManager();
		const sent: Array<{ message: Record<string, unknown>; options: unknown }> = [];
		const kickoffs: unknown[] = [];
		const pi = {
			events: { emit() {} },
			sendMessage: (message: Record<string, unknown>, options: unknown) => sent.push({ message, options }),
			sendUserMessage: (content: string, options: unknown) => kickoffs.push({ content, options, messagesBeforeKickoff: sent.length }),
		} as never;
		checkpointManager.ensureInitialized(pi, ctx, true);
		const identity = checkpointManager.currentIdentity();
		const controller = new AbortController();
		const manual = { reason: "manual", customInstructions: "Preserve the deployment decision", signal: controller.signal } as never;
		const cancelled = { reason: "manual", aborted: true } as never;
		assert.deepEqual(checkpointManager.prepareCompaction(manual, mode), { cancel: true });
		assert.equal(sent.length, 1, "checkpoint waits until Pi leaves manual compaction");
		checkpointManager.finishManualCheckpointRequest(pi, ctx, cancelled, true);
		assert.equal(sent.length, 2);
		assert.deepEqual(sent[1]!.options, { triggerTurn: false });
		assert.deepEqual(kickoffs, [{ content: "Continue.", options: { deliverAs: "steer" }, messagesBeforeKickoff: 2 }]);
		assert.match(String(sent[1]!.message["content"]), /Preserve the deployment decision/);
		assert.deepEqual(checkpointManager.currentIdentity(), identity, "manual request does not cut the window");
		checkpointManager.finishManualCheckpointRequest(pi, ctx, cancelled, true);
		assert.equal(sent.length, 2, "cancellation completion consumes the request once");
		checkpointManager.prepareCompaction(manual, mode);
		checkpointManager.finishManualCheckpointRequest(pi, ctx, cancelled, false);
		assert.equal(sent.length, 2, "disabled mode cannot start a checkpoint turn");
		checkpointManager.prepareCompaction(manual, mode);
		controller.abort();
		checkpointManager.finishManualCheckpointRequest(pi, ctx, cancelled, true);
		assert.equal(sent.length, 2, "user cancellation cannot start a checkpoint turn");
		assert.equal(kickoffs.length, 1);
		checkpointManager.prepareCompaction({ reason: "manual", signal: new AbortController().signal } as never, mode);
		checkpointManager.finishManualCheckpointRequest(
			pi,
			{ isIdle: () => false, ui: { notify() {} } } as never,
			cancelled,
			true,
		);
		assert.deepEqual(sent[2]!.options, { deliverAs: "steer", triggerTurn: true });
		assert.equal(kickoffs.length, 1, "active runs receive steering without another kickoff");
	}
	const hybridMessages = [
		{ role: "user", content: "retained checkpoint tail", timestamp: 1 },
		...activeWindow,
	] as never;
	for (const mode of ["local", "tree", "remote"] as const)
		assert.deepEqual(manager.project(hybridMessages, mode, [], [], true), hybridMessages);

	const contextBridge = new CodexDeveloperMessageBridge();
	const contextKickoff = new CodexContextWindowKickoff(manager);
	const contextState: AdapterState = {
		enabled: true,
		cwd: "/repo",
		promptSkills: [],
		executionMode: "notebook",
		codexTurnState: createCodexTurnState(),
		developerMessages: contextBridge,
		contextWindows: manager,
		contextKickoff,
		contextTree: new CodexContextTreeCoordinator(manager, contextKickoff),
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
		(["local", "tree", "remote"] as const).flatMap((mode) => [false, true].map(async (hybridCompaction) => {
			const sent: Array<Record<string, unknown>> = [];
			const kickoffs: string[] = [];
			let idle = false;
			const continuationContext = { ...(ctx as ExtensionContext), isIdle: () => idle } as ExtensionContext;
			let boundaryRefreshes = 0;
			const windows = new CodexContextWindowManager(
				async (_context, loadedMode) => `hint:${loadedMode}`,
				async () => {
					assert.equal(sent.length, 1, "refresh finishes before the successor can start a turn");
					boundaryRefreshes++;
				},
			);
			const kickoff = new CodexContextWindowKickoff(windows);
			const pi = {
				sendMessage(message: Record<string, unknown>, options: unknown) {
					assert.deepEqual(options, { triggerTurn: false }, "window markers never bypass the prompt lifecycle");
					sent.push(message);
				},
				sendUserMessage(text: string) { kickoffs.push(text); },
			} as never;
			windows.ensureInitialized(pi, ctx, true);
			assert.equal(boundaryRefreshes, 0, "initialization is not a rollover");
			if (hybridCompaction) {
				let complete: (() => void) | undefined;
				let compactions = 0;
				const compactContext = {
					...(ctx as ExtensionContext),
					compact(options: { onComplete: () => void }) {
						compactions++;
						complete = options.onComplete;
					},
				} as never;
				const [rollover] = createContextWindowTools(pi, {
					...contextState,
					contextWindows: windows,
					contextKickoff: kickoff,
					config: { ...contextState.config, compaction: { ...contextState.config.compaction, contextManagement: mode, hybridCompaction } },
				});
				const result = await rollover.execute("rollover", {}, undefined, undefined, compactContext);
				assert.equal(result.details.started, true);
				assert.equal(result.terminate, true);
				assert.equal(windows.scheduleHybridCompaction(), false);
				windows.cancelScheduledCompaction();
				const continueWindow = () => kickoff.startWindow(pi, ctx, { mode, triggerTurn: true, trimPreviousWindow: false });
				assert.equal(windows.finishTurn(compactContext, continueWindow), false);
				assert.equal(windows.scheduleHybridCompaction(), true);
				assert.equal(compactions, 0, "tool execution only schedules rollover");
				windows.finishTurn(compactContext, continueWindow);
				windows.finishTurn(compactContext, continueWindow);
				assert.equal(compactions, 1);
				await windows.completeHybridCompaction(pi, ctx, mode);
				assert.equal(sent.length, 1, "window changes only after explicit compaction completes");
				complete!();
				await new Promise<void>((resolve) => setImmediate(resolve));
				assert.equal(sent.length, 2);
			} else await kickoff.startWindow(pi, ctx, {
				triggerTurn: true,
				mode,
				trimPreviousWindow: mode !== "tree",
			});
			assert.equal(kickoff.pending, true);
			assert.equal(kickoff.continue(pi, continuationContext), false, "never steer a synthetic kickoff into the departing run");
			assert.equal(kickoffs.length, 0);
			idle = true;
			assert.equal(kickoff.continue(pi, continuationContext), true);
			assert.equal(kickoff.continue(pi, continuationContext), false, "one kickoff per window");
			assert.equal(kickoffs.length, 1);
			assert.equal(boundaryRefreshes, 1, "Hybrid compaction and its successor share one refresh");
			const persisted = sent.map((message) => ({ ...message, role: "custom", timestamp: 1 })) as never;
			const bridge = new CodexDeveloperMessageBridge();
			for (const id of ["gpt-6-astra", "gpt-5.6-luna", "gpt-6-astra"]) {
				const model = { ...(codexModel as Model<Api>), id };
				const carried = bridge.prepare(persisted, true, model);
				const payload = bridge.rewritePayload({ input: carried.map((message) => ({ role: "user", content: (message as { content: string }).content })) }, model);
				const serialized = serializeMessagesToResponsesInput(model, persisted);
				for (const output of [payload, serialized]) {
					const text = JSON.stringify(output);
					assert.equal(text.includes("Notes persist across windows"), id !== "gpt-6-astra");
					assert.equal(text.includes("Checkpoint the active request"), id === "gpt-6-astra");
				}
			}
			assert.equal(JSON.stringify(sent).includes("Notes persist across windows"), false, "request guidance does not mutate persisted window markers");
			return sent.at(-1)?.["content"];
		})),
	);
	assert.deepEqual(
		modeHints.map((hint) => String(hint).match(/hint:(local|tree|remote)/)?.[1]),
		["local", "local", "tree", "tree", "remote", "remote"],
	);
});
