import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { shouldUseCodexAdapter, shouldUseNativeResponsesCompaction, syncAdapter } from "../src/adapter/activation/activation.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { registerCodexTools } from "../src/extension/tools.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

function createToolHarness(activeTools: string[]) {
	const registeredTools = new Set(activeTools);
	return {
		getActiveTools: () => activeTools,
		setActiveTools: (nextTools: string[]) => {
			activeTools = nextTools;
		},
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

function createContext(model: { provider: string; api: string; id: string; input?: string[] }, statuses?: unknown[]) {
	return {
		hasUI: Boolean(statuses),
		model,
		ui: { setStatus: (_key: string, value: unknown) => statuses?.push(value) },
	};
}

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

test("voice-only honors selected extras by provider scope without enabling the adapter", () => {
	const codexModel = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", input: ["text", "image"] };
	const otherModel = { provider: "other", api: "openai-responses", id: "other-model", input: ["text"] };
	const extraTools = ["apply_patch", "view_image", "web_run", "imagegen"];
	const cases = [
		{ name: "off outside Codex scope", mode: "normal", scope: { allProviders: "off", additionalProviders: [] }, model: otherModel, expected: [] },
		{ name: "off on Codex", mode: "normal", scope: { allProviders: "off", additionalProviders: [] }, model: codexModel, expected: extraTools },
		{ name: "extra tools only", mode: "normal", scope: { allProviders: "extras", additionalProviders: [] }, model: otherModel, expected: extraTools },
		{ name: "all providers with inactive PATH config", mode: "path", scope: { allProviders: "on", additionalProviders: [] }, model: otherModel, expected: extraTools },
	] as const;

	for (const item of cases) {
		const state = createAdapterState({
			mode: item.mode,
			voiceFeaturesOnly: true,
			scope: { allProviders: item.scope.allProviders, additionalProviders: [...item.scope.additionalProviders] },
			tools: { webRun: false, imageGeneration: false, applyPatchOnly: true, viewImageOnly: true, webRunOnly: true, imageGenerationOnly: true, viewImageFallback: true },
			beta: { codeMode: true, responsesLite: false },
			compaction: { responsesCompaction: true },
		});
		const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
		registerCodexTools(pi as never, { state, registeredNativeWebSearchTools: new Set<string>() } as never);
		const statuses: unknown[] = [];
		const ctx = createContext(item.model, statuses);

		syncAdapter(pi as never, ctx as never, state);

		assert.deepEqual(pi.activeTools().filter((name) => extraTools.includes(name)), item.expected, item.name);
		assert.ok(item.expected.every((name) => pi.registeredTools().has(name)), `${item.name}: selected extras registered`);
		assert.ok(["read", "bash", "edit", "write", "parallel"].every((name) => pi.activeTools().includes(name)), `${item.name}: unrelated tools preserved`);
		assert.ok(["exec_command", "write_stdin", "exec", "wait"].every((name) => !pi.activeTools().includes(name)), `${item.name}: adapter tools suppressed`);
		assert.equal(shouldUseCodexAdapter(ctx as never, state.config), false, item.name);
		assert.equal(shouldUseNativeResponsesCompaction(ctx as never, state.config), false, item.name);
		assert.equal(statuses.at(-1), undefined, `${item.name}: adapter status suppressed`);
	}
});
