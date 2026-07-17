import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { shouldUseNativeResponsesCompaction, syncAdapter } from "../src/adapter/activation/activation.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

function createToolHarness(activeTools: string[]) {
	return {
		getActiveTools: () => activeTools,
		setActiveTools: (nextTools: string[]) => {
			activeTools = nextTools;
		},
		activeTools: () => activeTools,
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

function createContext(model: { provider: string; api: string; id: string }) {
	return {
		hasUI: false,
		model,
		ui: { setStatus: () => undefined },
	};
}

test("syncAdapter preserves unrelated tools across repeated syncs", () => {
	const pi = createToolHarness(["read", "custom_search", "custom_image", "parallel"]);
	const ctx = createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" });
	const state = createAdapterState();

	syncAdapter(pi as never, ctx as never, state);
	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "apply_patch", "custom_search", "custom_image", "parallel"]);
});

test("Code Mode activation stays within its model, API, and provider scope", () => {
	const cases = [
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna" }, configured: false, active: true },
		{ model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" }, configured: true, active: true },
		{ model: { provider: "litellm", api: "openai-completions", id: "gpt-5.6" }, configured: true, active: false },
		{ model: { provider: "litellm", api: "azure-openai-responses", id: "gpt-5.6" }, configured: true, active: false },
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5" }, configured: false, active: false },
		{ model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6" }, configured: false, active: false },
		{ model: { provider: "openai", api: "openai-responses", id: "gpt-5.6-luna" }, configured: false, active: false },
		{ model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" }, configured: false, active: false },
	];

	for (const { model, configured, active } of cases) {
		const pi = createToolHarness(["read", "bash", "edit", "write", "exec", "wait", "parallel"]);
		const state = createAdapterState({
			beta: { codeMode: true, responsesLite: false },
			scope: { allProviders: "off", additionalProviders: configured ? [model.provider] : [] },
		});
		syncAdapter(pi as never, createContext(model) as never, state);

		assert.equal(pi.activeTools().includes("exec"), active, JSON.stringify(model));
		assert.equal(pi.activeTools().includes("wait"), active, JSON.stringify(model));
	}
});

test("native Responses compaction stays scoped to OpenAI Codex and explicit providers", () => {
	const config = createAdapterState({ scope: { allProviders: "on", additionalProviders: ["my-provider"] }, compaction: { responsesCompaction: true } }).config;

	assert.equal(shouldUseNativeResponsesCompaction(createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" }) as never, config), false);
	assert.equal(shouldUseNativeResponsesCompaction(createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5" }) as never, config), true);
	assert.equal(shouldUseNativeResponsesCompaction(createContext({ provider: "my-provider", api: "openai-codex-responses", id: "gpt-5" }) as never, config), true);
});
