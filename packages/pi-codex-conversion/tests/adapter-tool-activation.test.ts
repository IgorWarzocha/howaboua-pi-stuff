import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { syncAdapter } from "../src/adapter/activation/activation.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { mergeAdapterTools } from "../src/index.ts";

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
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			...overrides,
			scope: { ...DEFAULT_CODEX_CONVERSION_CONFIG.scope, ...overrides.scope },
			tools: { ...DEFAULT_CODEX_CONVERSION_CONFIG.tools, ...overrides.tools },
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

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "apply_patch", "custom_search", "custom_image", "parallel"]);
});

test("syncAdapter leaves PATH tools to shell for configured custom providers", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "my-provider", api: "custom-responses", id: "gpt-5" });
	const state = createAdapterState({ mode: "path", scope: { allProviders: false, additionalProviders: ["my-provider"] } });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["exec_command", "write_stdin", "parallel"]);
});

test("applyPatchOnly overlays only apply_patch without Codex toolkit rewrites", () => {
	const pi = createToolHarness(["read", "bash", "edit", "write", "parallel"]);
	const ctx = createContext({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5" });
	const state = createAdapterState({ tools: { ...DEFAULT_CODEX_CONVERSION_CONFIG.tools, applyPatchOnly: true } });

	syncAdapter(pi as never, ctx as never, state);

	assert.deepEqual(pi.activeTools(), ["read", "bash", "edit", "write", "parallel", "apply_patch"]);
});
