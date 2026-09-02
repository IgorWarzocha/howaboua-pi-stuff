import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { syncAdapter } from "../src/adapter/activation/activation.ts";
import { resolveCodexRuntimePlan } from "../src/adapter/activation/runtime-plan.ts";
import {
	getCodeModeExtensionTools,
	registerCodeModeExtensionTools,
} from "../src/code-mode-extension-tools.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

const CANONICAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function createToolHarness(activeTools: string[]) {
	const registeredTools = new Set(activeTools);
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
		setActiveTools: (nextTools: string[]) => {
			activeTools = nextTools;
		},
		on: () => undefined,
		registerTool: (tool: { name: string }) => registeredTools.add(tool.name),
		activeTools: () => activeTools,
		registeredTools: () => registeredTools,
	};
}

function createAdapterState(overrides: Partial<AdapterState["config"]> = {}): AdapterState {
	return {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		executionMode: overrides.executionMode ?? DEFAULT_CODEX_CONVERSION_CONFIG.executionMode,
		codexTurnState: createCodexTurnState(),
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

test("Code Mode activation stays within its model, API, and provider scope", () => {
	const cases = [
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: CANONICAL_CODEX_BASE_URL }, configured: false, active: true },
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: "https://codex-proxy.example.com/backend-api" }, configured: false, active: true },
		{ model: { provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: CANONICAL_CODEX_BASE_URL }, configured: false, active: true },
		{ model: { provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: "https://codex-proxy.example.com/backend-api" }, configured: false, active: true },
		{ model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" }, configured: true, active: true },
		{ model: { provider: "litellm", api: "openai-completions", id: "gpt-5.6" }, configured: true, active: false },
		{ model: { provider: "litellm", api: "azure-openai-responses", id: "gpt-5.6" }, configured: true, active: false },
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5", baseUrl: CANONICAL_CODEX_BASE_URL }, configured: false, active: false },
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6", baseUrl: CANONICAL_CODEX_BASE_URL }, configured: false, active: false },
		{ model: { provider: "openai", api: "openai-responses", id: "gpt-5.6-luna" }, configured: false, active: false },
		{ model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" }, configured: false, active: false },
	];

	for (const { model, configured, active } of cases) {
		const pi = createToolHarness(["read", "bash", "edit", "write", "exec", "wait", "parallel"]);
		const state = createAdapterState({
			executionMode: "code",
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, proxyResponsesLite: true },
			scope: { allProviders: "off", additionalProviders: configured ? [model.provider] : [] },
		});
		syncAdapter(pi as never, createContext(model) as never, state);

		assert.equal(pi.activeTools().includes("exec"), active, JSON.stringify(model));
		assert.equal(pi.activeTools().includes("wait"), active, JSON.stringify(model));
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
			name: "agents",
			usage: "await tools.agents(input)",
			deferLoading: false,
			kind: "function",
			inputSchema: {},
			async invoke() { return ""; },
		}],
		{ isActive: () => orchestrationActive },
	);
	const dynamicState = createAdapterState({ executionMode: "code" });
	const dynamicModel = cases[0]?.model;
	assert.ok(dynamicModel);
	const dynamicContext = createContext(dynamicModel);
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.equal(dynamic.activeTools().includes("agents"), false);
	assert.deepEqual(getCodeModeExtensionTools(dynamic as never, dynamicContext as never), []);

	orchestrationActive = true;
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.equal(dynamic.activeTools().includes("agents"), false);
	assert.deepEqual(
		getCodeModeExtensionTools(dynamic as never, dynamicContext as never).map(
			(tool) => tool.name,
		),
		["agents"],
	);
	dynamicState.executionMode = "normal";
	syncAdapter(dynamic as never, dynamicContext as never, dynamicState);
	assert.equal(dynamic.activeTools().includes("agents"), true);
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

	const namespaced = createToolHarness([
		"read",
		"bash",
		"edit",
		"write",
		"web_run",
	]);
	registerCodeModeExtensionTools(namespaced as never, () => [{
		name: "web__run",
		topLevelName: "web_run",
		toolName: { namespace: "web", name: "run" },
		usage: "await tools.web__run(input)",
		deferLoading: false,
		kind: "function",
		inputSchema: {},
		async invoke() { return ""; },
	}]);
	const namespacedState = createAdapterState({ executionMode: "code" });
	syncAdapter(
		namespaced as never,
		conflictingContext as never,
		namespacedState,
	);
	assert.equal(namespaced.activeTools().includes("web_run"), false);
	namespacedState.executionMode = "normal";
	syncAdapter(
		namespaced as never,
		conflictingContext as never,
		namespacedState,
	);
	assert.equal(namespaced.activeTools().includes("web_run"), true);
});

test("runtime plan keeps unsupported and non-Lite models on structured standard Responses", () => {
	const config = createAdapterState({
		executionMode: "code",
		openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, proxyResponsesLite: false },
		scope: { allProviders: "off", additionalProviders: ["litellm"] },
	}).config;
	const pre56 = resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config);
	const proxyWithoutLite = resolveCodexRuntimePlan(createContext({ provider: "litellm", api: "openai-responses", id: "gpt-5.6" }) as never, config);
	const proxyWithLite = resolveCodexRuntimePlan(
		createContext({ provider: "litellm", api: "openai-responses", id: "gpt-5.6" }) as never,
		{ ...config, openai: { ...config.openai, proxyResponsesLite: true } },
	);

	assert.equal(pre56.kind, "normal");
	assert.equal(pre56.transport, "responses");
	assert.ok(pre56.toolNames.includes("exec_command"));
	assert.deepEqual({ kind: proxyWithoutLite.kind, transport: proxyWithoutLite.transport }, { kind: "normal", transport: "responses" });
	assert.deepEqual({ kind: proxyWithLite.kind, transport: proxyWithLite.transport }, { kind: "code", transport: "responses-lite" });
});

test("native Responses compaction stays scoped to OpenAI Codex and explicit providers", () => {
	const config = createAdapterState({
		scope: { allProviders: "on", additionalProviders: ["my-provider"] },
		compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, responsesCompaction: true },
	}).config;

	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" }) as never, config).nativeCompaction, false);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5", baseUrl: "https://codex-proxy.example.com/backend-api" }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5", baseUrl: "https://codex-proxy.example.com/backend-api" }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "my-provider", api: "openai-codex-responses", id: "gpt-5" }) as never, config).nativeCompaction, true);
});
