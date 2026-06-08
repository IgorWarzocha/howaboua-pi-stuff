import test from "node:test";
import assert from "node:assert/strict";
import { migrateCodexConversionConfigIfNeeded } from "../src/adapter/activation/config-migration.ts";
import { normalizeCodexConversionConfig, DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";

test("old flat config migrates to grouped config and preserves providers", () => {
	const migration = migrateCodexConversionConfigIfNeeded({
		useOnAllModels: true,
		useAdapterProviders: false,
		adapterProviders: [" My-Provider "],
		statusLine: false,
		backgroundShellWidget: false,
		fast: true,
		verbosity: "high",
		forceCachedWebSockets: false,
		responsesCompaction: true,
		compactionModel: "gpt-5.5",
		compactionReasoning: "medium",
	});
	assert.equal(migration.migrated, true);
	const config = normalizeCodexConversionConfig(migration.config);
	assert.equal(config.mode, "normal");
	assert.deepEqual(config.scope, { allProviders: true, additionalProviders: ["my-provider"] });
	assert.equal(config.ui.statusLine, false);
	assert.equal(config.ui.toolRendering, true);
	assert.equal(config.ui.backgroundShellWidget, false);
	assert.equal(config.compaction.responsesCompaction, true);
	assert.equal(config.openai.fast, true);
	assert.equal(config.openai.verbosity, "high");
	assert.equal(config.openai.forceCachedWebSockets, false);
	assert.equal(config.openai.compactionModel, "gpt-5.5");
	assert.equal(config.openai.compactionReasoning, "medium");
});

test("new default compaction model is gpt-5.4-mini", () => {
	assert.equal(DEFAULT_CODEX_CONVERSION_CONFIG.openai.compactionModel, "gpt-5.4-mini");
	assert.equal(normalizeCodexConversionConfig({}).openai.compactionModel, "gpt-5.4-mini");
});

test("tool rendering defaults on and can be disabled", () => {
	assert.equal(DEFAULT_CODEX_CONVERSION_CONFIG.ui.toolRendering, true);
	assert.equal(normalizeCodexConversionConfig({ ui: { toolRendering: false } }).ui.toolRendering, false);
});
