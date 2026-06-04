import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG, normalizeProviderList } from "../src/adapter/config.ts";
import { syncAdapter } from "../src/adapter/activation.ts";
import type { AdapterState } from "../src/adapter/state.ts";
import { mergeAdapterTools, restoreTools } from "../src/index.ts";

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
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, imageGeneration: false, webSearch: false, ...overrides },
	};
}

function createContext(model: { provider: string; api: string; id: string }) {
	return {
		hasUI: false,
		model,
		ui: { setStatus: () => undefined },
	};
}

test("mergeAdapterTools replaces Pi core tools while preserving unrelated tools", () => {
	assert.deepEqual(
		mergeAdapterTools(["read", "bash", "edit", "write", "parallel", "custom_search"], ["exec_command", "write_stdin", "apply_patch"]),
		["exec_command", "write_stdin", "apply_patch", "parallel", "custom_search"],
	);
});

test("syncAdapter preserves disabled optional tools across repeated syncs", () => {
	const pi = createToolHarness(["read", "web_search", "image_generation", "parallel"]);
	const ctx = createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" });
	const state = createAdapterState({ webSearch: false, imageGeneration: false });

	syncAdapter(pi as never, ctx as never, state);
	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "apply_patch", "web_search", "image_generation", "parallel"]);
});

test("syncAdapter add-apply_patch-only mode is gated to Codex-like models", () => {
	const codexPi = createToolHarness(["read", "bash", "edit", "write", "web_search", "image_generation", "parallel"]);
	syncAdapter(
		codexPi as never,
		createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" }) as never,
		createAdapterState({ applyPatchOnly: true, webSearch: true, imageGeneration: true }),
	);
	assert.deepEqual(codexPi.activeTools(), ["read", "bash", "edit", "write", "web_search", "parallel", "apply_patch"]);

	const plainPi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	syncAdapter(
		plainPi as never,
		createContext({ provider: "anthropic", api: "anthropic-messages", id: "claude" }) as never,
		createAdapterState({ applyPatchOnly: true, webSearch: true, imageGeneration: true }),
	);
	assert.deepEqual(plainPi.activeTools(), ["read", "bash", "edit", "write", "parallel"]);
});

test("syncAdapter enables adapter for configured custom providers", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ useAdapterProviders: true, adapterProviders: ["my-provider"] });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "apply_patch", "parallel"]);
});

test("syncAdapter can disable optional native tools for configured custom providers", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" }) as ReturnType<typeof createContext> & { model: { input: string[] } };
	ctx.model.input = ["text", "image"];
	const state = createAdapterState({ useAdapterProviders: true, adapterProviders: ["my-provider"], adapterProviderCodexTools: false, webSearch: true, imageGeneration: true });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "apply_patch", "view_image", "parallel"]);
});

test("syncAdapter enables optional native tools for configured custom providers by default", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ useAdapterProviders: true, adapterProviders: ["my-provider"], webSearch: true, imageGeneration: true });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "apply_patch", "web.run", "image_generation", "parallel"]);
});

test("normalizeProviderList trims, lowercases, dedupes, and ignores invalid entries", () => {
	assert.deepEqual(normalizeProviderList([" My-Provider ", "my-provider", "", 42]), ["my-provider"]);
});

test("syncAdapter does not enable adapter for unlisted custom providers", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "custom-llm", api: "custom-chat", id: "claude" });
	const state = createAdapterState({ useAdapterProviders: true, adapterProviders: ["my-provider"] });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["read", "bash", "edit", "write", "parallel"]);
});

test("syncAdapter ignores configured custom providers while codex proxy is off", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ useAdapterProviders: false, adapterProviders: ["my-provider"] });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["read", "bash", "edit", "write", "parallel"]);
});

test("syncAdapter custom provider list is adapter-only in apply_patch-only mode", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ applyPatchOnly: true, useAdapterProviders: true, adapterProviders: ["my-provider"] });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["read", "bash", "edit", "write", "parallel"]);
});

test("restoreTools restores previous tools and keeps custom tools added while adapter mode was enabled", () => {
	assert.deepEqual(
		restoreTools(["read", "bash", "edit", "write", "parallel"], ["exec_command", "write_stdin", "apply_patch", "parallel", "custom_search"]),
		["read", "bash", "edit", "write", "parallel", "custom_search"],
	);
});
