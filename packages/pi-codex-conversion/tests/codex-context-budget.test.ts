import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyCodexContextBudgetToModel, getCodexAutoCompactBudget, getCodexContextBudgetAdjustedModel, getPiContextWindowForCodexAutoCompact, readPiCompactionReserveTokens } from "../src/adapter/codex-context-budget.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/config.ts";
import type { AdapterState } from "../src/adapter/state.ts";

test("Codex auto compact budget uses 90 percent of Pi's resolved model window", () => {
	assert.equal(getCodexAutoCompactBudget(272_000), 244_800);
	assert.equal(getPiContextWindowForCodexAutoCompact(272_000), 261_184);
});

test("adjusts only openai-codex responses model context windows for Pi reserve semantics", () => {
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: DEFAULT_CODEX_CONVERSION_CONFIG,
		codexContextBudgetReserveTokens: 16_384,
	};
	const codexModel = {
		id: "gpt-5.5",
		name: "GPT-5.5",
		provider: "openai-codex",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
	};

	const adjusted = getCodexContextBudgetAdjustedModel(codexModel as never, state);
	assert.equal(adjusted.contextWindow, 261_184);
	assert.equal(getCodexContextBudgetAdjustedModel(adjusted as never, state), adjusted);

	const openAiModel = { ...codexModel, provider: "openai", api: "openai-responses", contextWindow: 400_000 };
	assert.equal(getCodexContextBudgetAdjustedModel(openAiModel as never, state), openAiModel);
});

test("does not recursively shrink a shared Codex model across fresh adapter states", () => {
	const model = {
		id: "gpt-5.5",
		name: "GPT-5.5",
		provider: "openai-codex",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
	};

	for (let index = 0; index < 4; index++) {
		const state: AdapterState = {
			enabled: false,
			cwd: process.cwd(),
			promptSkills: [],
			config: DEFAULT_CODEX_CONVERSION_CONFIG,
			codexContextBudgetReserveTokens: 16_384,
		};
		applyCodexContextBudgetToModel(model as never, state);
		assert.equal(model.contextWindow, 261_184);
	}
});

test("uses the configured Pi compaction reserve when deriving adjusted context windows", () => {
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: DEFAULT_CODEX_CONVERSION_CONFIG,
		codexContextBudgetReserveTokens: 32_000,
	};
	const codexModel = {
		id: "gpt-5.5",
		name: "GPT-5.5",
		provider: "openai-codex",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
	};

	assert.equal(getCodexContextBudgetAdjustedModel(codexModel as never, state).contextWindow, 272_000);
});

test("clamps adjusted context windows to the raw model limit", () => {
	assert.equal(getPiContextWindowForCodexAutoCompact(272_000, 68_000), 272_000);
	assert.equal(getPiContextWindowForCodexAutoCompact(272_000, 0), 244_800);
});

test("preserves the cached raw window when reserve changes after adjustment", () => {
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: DEFAULT_CODEX_CONVERSION_CONFIG,
		codexContextBudgetReserveTokens: 16_384,
	};
	const rawModel = {
		id: "gpt-5.5",
		name: "GPT-5.5",
		provider: "openai-codex",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
	};
	const adjusted = getCodexContextBudgetAdjustedModel(rawModel as never, state);
	assert.equal(adjusted.contextWindow, 261_184);

	state.codexContextBudgetReserveTokens = 0;
	const adjustedAfterReserveChange = getCodexContextBudgetAdjustedModel(adjusted as never, state);
	assert.equal(adjustedAfterReserveChange.contextWindow, 244_800);
});

test("refreshes cached raw windows when model metadata changes", () => {
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: DEFAULT_CODEX_CONVERSION_CONFIG,
		codexContextBudgetReserveTokens: 16_384,
	};
	const model = {
		id: "gpt-5.5",
		name: "GPT-5.5",
		provider: "openai-codex",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
	};
	getCodexContextBudgetAdjustedModel(model as never, state);

	const changedModel = { ...model, contextWindow: 300_000 };
	assert.equal(getCodexContextBudgetAdjustedModel(changedModel as never, state).contextWindow, 286_384);
});

test("reads project compaction reserve over global reserve", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-budget-"));
	const agentDir = mkdtempSync(join(tmpdir(), "pi-codex-agent-"));
	const oldAgentDir = process.env["PI_CODING_AGENT_DIR"]!;
	try {
		process.env["PI_CODING_AGENT_DIR"] = agentDir;
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { reserveTokens: 20_000 } }));
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ compaction: { reserveTokens: 30_000 } }));
		assert.equal(readPiCompactionReserveTokens(cwd), 30_000);
	} finally {
		if (oldAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = oldAgentDir;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("accepts zero compaction reserve from settings", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-budget-zero-"));
	try {
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ compaction: { reserveTokens: 0 } }));
		assert.equal(readPiCompactionReserveTokens(cwd), 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
