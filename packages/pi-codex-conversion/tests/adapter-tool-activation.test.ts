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
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, ...overrides },
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
		mergeAdapterTools(["read", "bash", "edit", "write", "parallel", "custom_search"], ["exec_command", "write_stdin"]),
		["exec_command", "write_stdin", "parallel", "custom_search"],
	);
});

test("syncAdapter preserves unrelated tools across repeated syncs", () => {
	const pi = createToolHarness(["read", "custom_search", "custom_image", "parallel"]);
	const ctx = createContext({ provider: "openai", api: "openai-responses", id: "gpt-5" });
	const state = createAdapterState();

	syncAdapter(pi as never, ctx as never, state);
	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "custom_search", "custom_image", "parallel"]);
});

test("syncAdapter enables adapter for configured custom providers", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ useAdapterProviders: true, adapterProviders: ["my-provider"] });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "parallel"]);
});

test("syncAdapter leaves PATH tools to shell for configured custom providers", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ useAdapterProviders: true, adapterProviders: ["my-provider"] });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "parallel"]);
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

test("restoreTools restores previous tools and keeps custom tools added while adapter mode was enabled", () => {
	assert.deepEqual(
		restoreTools(["read", "bash", "edit", "write", "parallel"], ["exec_command", "write_stdin", "parallel", "custom_search"]),
		["read", "bash", "edit", "write", "parallel", "custom_search"],
	);
});
