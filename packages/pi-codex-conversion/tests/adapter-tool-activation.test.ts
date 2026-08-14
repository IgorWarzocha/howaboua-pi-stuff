import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { syncAdapter } from "../src/adapter/activation/activation.ts";
import { resolveCodexRuntimePlan } from "../src/adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { rewriteCodexProviderHeaders } from "../src/adapter/provider-request.ts";
import { isCanonicalCodexSubscriptionModel, isCodexTransportModel } from "../src/adapter/prompt/codex-model.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

const CANONICAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function createToolHarness(activeTools: string[]) {
	const registeredTools = new Set(activeTools);
	return {
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
		codexTurnState: createCodexTurnState(),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			...overrides,
			scope: { ...DEFAULT_CODEX_CONVERSION_CONFIG.scope, ...overrides.scope },
			tools: { ...DEFAULT_CODEX_CONVERSION_CONFIG.tools, ...overrides.tools },
			beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, ...overrides.beta },
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

test("Codex transport identity is broader than the canonical subscription trust boundary", () => {
	const alias = {
		provider: "openai-codex-personal",
		api: "openai-codex-responses",
		id: "gpt-5.6-sol",
		baseUrl: CANONICAL_CODEX_BASE_URL,
	};
	const cases = [
		{ model: alias, canonical: true, transport: true },
		{ model: { ...alias, baseUrl: `${CANONICAL_CODEX_BASE_URL}/codex/` }, canonical: true, transport: true },
		{ model: { ...alias, api: "openai-responses" }, canonical: false, transport: false },
		{ model: { ...alias, baseUrl: "https://chatgpt.com.example/backend-api" }, canonical: false, transport: false },
		{ model: { ...alias, baseUrl: `${CANONICAL_CODEX_BASE_URL}?proxy=1` }, canonical: false, transport: false },
		{ model: { ...alias, baseUrl: "https://chatgpt.com:8443/backend-api" }, canonical: false, transport: false },
		{
			model: { ...alias, provider: "openai-codex", baseUrl: "https://codex-proxy.example.com/backend-api" },
			canonical: false,
			transport: true,
		},
	];

	for (const { model, canonical, transport } of cases) {
		assert.equal(isCanonicalCodexSubscriptionModel(model), canonical, JSON.stringify(model));
		assert.equal(isCodexTransportModel(model), transport, JSON.stringify(model));
	}
});

test("Code Mode activation stays within its model, API, and provider scope", () => {
	const cases = [
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: CANONICAL_CODEX_BASE_URL }, configured: false, active: true },
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: "https://codex-proxy.example.com/backend-api" }, configured: false, active: true },
		{ model: { provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: CANONICAL_CODEX_BASE_URL }, configured: false, active: true },
		{ model: { provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5.6-luna", baseUrl: "https://example.com/backend-api" }, configured: false, active: false },
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
			beta: { codeMode: true, responsesLite: true },
			scope: { allProviders: "off", additionalProviders: configured ? [model.provider] : [] },
		});
		syncAdapter(pi as never, createContext(model) as never, state);

		assert.equal(pi.activeTools().includes("exec"), active, JSON.stringify(model));
		assert.equal(pi.activeTools().includes("wait"), active, JSON.stringify(model));
	}
});

test("runtime plan keeps unsupported and non-Lite models on structured standard Responses", () => {
	const config = createAdapterState({
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off", additionalProviders: ["litellm"] },
	}).config;
	const pre56 = resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config);
	const proxyWithoutLite = resolveCodexRuntimePlan(createContext({ provider: "litellm", api: "openai-responses", id: "gpt-5.6" }) as never, config);
	const proxyWithLite = resolveCodexRuntimePlan(
		createContext({ provider: "litellm", api: "openai-responses", id: "gpt-5.6" }) as never,
		{ ...config, beta: { ...config.beta, responsesLite: true } },
	);

	assert.deepEqual({ kind: pre56.kind, transport: pre56.transport }, { kind: "normal", transport: "responses" });
	assert.ok(pre56.kind === "normal");
	assert.ok(pre56.toolNames.includes("exec_command"));
	assert.deepEqual({ kind: proxyWithoutLite.kind, transport: proxyWithoutLite.transport }, { kind: "normal", transport: "responses" });
	assert.deepEqual({ kind: proxyWithLite.kind, transport: proxyWithLite.transport }, { kind: "code", transport: "responses-lite" });
});

test("native Responses compaction stays scoped to OpenAI Codex and explicit providers", () => {
	const config = createAdapterState({ scope: { allProviders: "on", additionalProviders: ["my-provider"] }, compaction: { responsesCompaction: true } }).config;

	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" }) as never, config).nativeCompaction, false);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5", baseUrl: "https://codex-proxy.example.com/backend-api" }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5", baseUrl: CANONICAL_CODEX_BASE_URL }) as never, config).nativeCompaction, true);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "openai-codex-personal", api: "openai-codex-responses", id: "gpt-5", baseUrl: "https://example.com/backend-api" }) as never, config).nativeCompaction, false);
	assert.equal(resolveCodexRuntimePlan(createContext({ provider: "my-provider", api: "openai-codex-responses", id: "gpt-5" }) as never, config).nativeCompaction, true);
});

test("canonical alias Code Mode marks the real provider request as Responses Lite", () => {
	const state = createAdapterState({
		beta: { codeMode: true, responsesLite: true },
		scope: { allProviders: "off", additionalProviders: [] },
	});
	const aliasHeaders: Record<string, string> = {};
	rewriteCodexProviderHeaders(aliasHeaders, createContext({
		provider: "openai-codex-personal",
		api: "openai-codex-responses",
		id: "gpt-5.6-sol",
		baseUrl: CANONICAL_CODEX_BASE_URL,
	}) as never, state);
	assert.equal(aliasHeaders["x-openai-internal-codex-responses-lite"], "true");

	const noncanonicalHeaders: Record<string, string> = {};
	rewriteCodexProviderHeaders(noncanonicalHeaders, createContext({
		provider: "openai-codex-personal",
		api: "openai-codex-responses",
		id: "gpt-5.6-sol",
		baseUrl: "https://example.com/backend-api",
	}) as never, state);
	assert.equal("x-openai-internal-codex-responses-lite" in noncanonicalHeaders, false);
});
