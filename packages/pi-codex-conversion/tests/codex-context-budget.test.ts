import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCodexContextBudgetAdjustedModel, readPiCompactionReserveTokens } from "../src/adapter/prompt/codex-context-budget.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";

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
