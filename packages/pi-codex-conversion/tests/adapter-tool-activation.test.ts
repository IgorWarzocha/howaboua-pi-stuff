import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { syncAdapter } from "../src/adapter/activation/activation.ts";
import { ALL_CODEX_ADAPTER_TOOL_NAMES, resolveCodexRuntimePlan, resolveCodexRuntimePlanForState } from "../src/adapter/activation/runtime-plan.ts";
import {
	getCodeModeExtensionTools,
	registerCodeModeExtensionTools,
} from "../src/code-mode-extension-tools.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import { CodexContextWindowKickoff } from "../src/context-management/window-kickoff.ts";
import { CodexContextTreeCoordinator } from "../src/context-management/tree-coordinator.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

const CANONICAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function createToolHarness(activeTools: string[], availableTools = [...activeTools, ...ALL_CODEX_ADAPTER_TOOL_NAMES]) {
	const registeredTools = new Set(availableTools);
	const handlers = new Map<string, Array<(value: unknown) => void>>();
	return {
		events: {
			emit: (channel: string, value: unknown) => {
				for (const handler of handlers.get(channel) ?? []) handler(value);
			},
			on: (channel: string, handler: (value: unknown) => void) => {
				const entries = handlers.get(channel) ?? [];
				entries.push(handler);
				handlers.set(channel, entries);
				return () => handlers.set(channel, entries.filter((entry) => entry !== handler));
			},
		},
		getActiveTools: () => activeTools,
		getAllTools: () => [...registeredTools].map((name) => ({ name })),
		setActiveTools: (nextTools: string[]) => {
			activeTools = nextTools.filter((name) => registeredTools.has(name));
		},
		on: () => undefined,
		registerTool: (tool: { name: string }) => registeredTools.add(tool.name),
		activeTools: () => activeTools,
		registeredTools: () => registeredTools,
	};
}

function createAdapterState(overrides: Partial<AdapterState["config"]> = {}): AdapterState {
	const contextWindows = new CodexContextWindowManager();
	const contextKickoff = new CodexContextWindowKickoff(contextWindows);
	return {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		executionMode: overrides.executionMode ?? DEFAULT_CODEX_CONVERSION_CONFIG.executionMode,
		codexTurnState: createCodexTurnState(),
		developerMessages: new CodexDeveloperMessageBridge(),
		contextWindows,
		contextKickoff,
		contextTree: new CodexContextTreeCoordinator(contextWindows, contextKickoff),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			...overrides,
			scope: { ...DEFAULT_CODEX_CONVERSION_CONFIG.scope, ...overrides.scope },
			tools: { ...DEFAULT_CODEX_CONVERSION_CONFIG.tools, ...overrides.tools },
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, ...overrides.openai },
		},
	};
}

function createContext(model: { provider: string; api: string; id: string; baseUrl?: string; input?: string[] }, statuses?: unknown[]) {
	return {
		hasUI: Boolean(statuses),
		model,
		ui: { setStatus: (_key: string, value: unknown) => statuses?.push(value) },
	};
}

test("adapter activation requires registered tools and follows scope independently of transport", () => {
	const original = ["read", "exec"];
	const unavailable = createToolHarness(original, original);
	const unavailableState = createAdapterState({ executionMode: "code" });
	const unavailableContext = createContext(
		{ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6-astra" },
		[],
	);
	const unavailablePlan = syncAdapter(unavailable as never, unavailableContext as never, unavailableState);
	assert.equal(unavailablePlan.kind, "inactive");
	assert.equal(unavailableState.enabled, false);
	assert.deepEqual(unavailable.activeTools(), original);
	assert.deepEqual(resolveCodexRuntimePlanForState(unavailableContext as never, unavailableState), unavailablePlan);

	const emptyAllowlist = createToolHarness([], ALL_CODEX_ADAPTER_TOOL_NAMES);
	const emptyAllowlistState = createAdapterState({ executionMode: "code" });
	syncAdapter(
		emptyAllowlist as never,
		createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6-astra" }) as never,
		emptyAllowlistState,
	);
	assert.deepEqual(emptyAllowlist.activeTools(), ["exec", "wait"]);
	syncAdapter(
		emptyAllowlist as never,
		createContext({ provider: "meta", api: "openai-responses", id: "muse" }) as never,
		emptyAllowlistState,
	);
	assert.deepEqual(emptyAllowlist.activeTools(), []);

	for (const configured of [false, true]) {
		const model = { provider: "litellm", api: "openai-responses", id: "gpt-5.6" };
		const pi = createToolHarness(["read", "bash", "edit", "write", "exec", "wait", "parallel"]);
		const state = createAdapterState({
			executionMode: "code",
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, proxyResponsesLite: true },
			scope: { allProviders: "off", additionalProviders: configured ? [model.provider] : [] },
		});
		syncAdapter(pi as never, createContext(model) as never, state);

		assert.equal(pi.activeTools().includes("exec"), configured);
	}

	const dynamic = createToolHarness([
		"read",
		"bash",
		"edit",
		"write",
		"agents",
	]);
	let orchestrationActive = false;
	const registration = registerCodeModeExtensionTools(
		dynamic as never,
		() => [{
			name: "orchestration__agents",
			topLevelName: "agents",
			toolName: { namespace: "orchestration", name: "agents" },
			usage: "await tools.agents(input)",
			deferLoading: false,
			kind: "function",
			inputSchema: {},
			async invoke() { return ""; },
		}],
		{ isActive: () => orchestrationActive },
	);
	const dynamicState = createAdapterState({ executionMode: "code" });
	const dynamicModel = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: CANONICAL_CODEX_BASE_URL };
	const dynamicContext = createContext(dynamicModel);
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.deepEqual(getCodeModeExtensionTools(dynamic as never, dynamicContext as never), []);

	orchestrationActive = true;
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.deepEqual(
		getCodeModeExtensionTools(dynamic as never, dynamicContext as never).map(
			(tool) => tool.name,
		),
		["orchestration__agents"],
	);
	assert.equal(dynamic.activeTools().includes("agents"), false);
	dynamic.registerTool({ name: "temporary" });
	dynamic.setActiveTools(["wait", "read", "temporary"]);
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.deepEqual(dynamic.activeTools(), ["wait", "read", "temporary"]);
	dynamicState.executionMode = "normal";
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.equal(dynamic.activeTools().includes("agents"), true);
	assert.equal(dynamic.activeTools().includes("temporary"), true);

	dynamicState.executionMode = "code";
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.deepEqual(dynamic.activeTools(), ["exec", "wait", "temporary"]);
	assert.deepEqual(
		getCodeModeExtensionTools(
			dynamic as never,
			dynamicContext as never,
			dynamicState.previousToolNames,
		).map((tool) => tool.name),
		["orchestration__agents"],
	);

	registration.unregister();

	const conflicting = createToolHarness(["read", "bash", "edit", "write"]);
	const conflictingContext = createContext(dynamicModel);
	const conflict = registerCodeModeExtensionTools(conflicting as never, () => [{
		name: "exec",
		usage: "await tools.exec()",
		deferLoading: false,
		kind: "function",
		inputSchema: {},
		async invoke() { return ""; },
	}]);
	assert.throws(
		() => getCodeModeExtensionTools(conflicting as never, conflictingContext as never),
		/Reserved Code Mode extension tool name: exec/,
	);
	conflict.unregister();
});

test("execution mode and Responses Lite transport resolve independently", () => {
	const config = createAdapterState({
		executionMode: "code",
		openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, proxyResponsesLite: false },
		scope: { allProviders: "off", additionalProviders: ["litellm"] },
	}).config;
	const astra = resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6-astra", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config);
	const proxyWithoutLite = resolveCodexRuntimePlan(createContext({ provider: "litellm", api: "openai-responses", id: "gpt-5.6" }) as never, config);

	assert.deepEqual({ kind: astra.kind, transport: astra.transport }, { kind: "code", transport: "responses-lite" });
	assert.deepEqual({ kind: proxyWithoutLite.kind, transport: proxyWithoutLite.transport }, { kind: "code", transport: "responses" });
});

test("native Responses compaction stays scoped to OpenAI Codex and explicit providers", () => {
	const config = createAdapterState({
		scope: { allProviders: "on", additionalProviders: ["my-provider"] },
		compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, responsesCompaction: true },
	}).config;

	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" }) as never, config).nativeCompaction, false);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "my-provider", api: "openai-codex-responses", id: "gpt-5" }) as never, config).nativeCompaction, true);
});
