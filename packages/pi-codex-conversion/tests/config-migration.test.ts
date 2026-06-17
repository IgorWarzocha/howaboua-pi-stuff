import test from "node:test";
import assert from "node:assert/strict";
import { migrateCodexConversionConfigIfNeeded } from "../src/adapter/activation/config-migration.ts";
import { normalizeCodexConversionConfig } from "../src/adapter/activation/config.ts";

test("old flat config migrates to grouped config and respects disabled provider gate", () => {
	const migration = migrateCodexConversionConfigIfNeeded({
		useOnAllModels: true,
		useAdapterProviders: false,
		adapterProviders: [" My-Provider "],
		webSearch: false,
		imageGeneration: false,
		adapterProviderCodexTools: false,
		applyPatchOnly: true,
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
	assert.deepEqual(config.scope, { allProviders: true, additionalProviders: [] });
	assert.deepEqual(config.tools, { webRun: false, imageGeneration: false, viewImageFallback: false, applyPatchOnly: true });
	assert.equal(config.ui.statusLine, false);
	assert.equal(config.ui.toolRendering, true);
	assert.equal(config.ui.backgroundShellWidget, false);
	assert.equal(config.compaction.responsesCompaction, true);
	assert.equal(config.openai.fast, true);
	assert.equal(config.openai.verbosity, "high");
	assert.equal(config.openai.forceCachedWebSockets, false);
	assert.equal(config.openai.webSearchModel, "gpt-5.4-mini");
	assert.equal(config.openai.compactionModel, "gpt-5.5");
	assert.equal(config.openai.compactionReasoning, "medium");
});

test("old flat config migrates adapter providers when old gate was enabled", () => {
	const migration = migrateCodexConversionConfigIfNeeded({
		useAdapterProviders: true,
		adapterProviders: [" My-Provider "],
	});
	const config = normalizeCodexConversionConfig(migration.config);
	assert.deepEqual(config.scope.additionalProviders, ["my-provider"]);
});

test("old flat config preserves disabled adapter provider Codex tools", () => {
	const migration = migrateCodexConversionConfigIfNeeded({
		useAdapterProviders: true,
		adapterProviders: ["renamed-codex"],
		webSearch: true,
		imageGeneration: true,
		adapterProviderCodexTools: false,
	});
	const config = normalizeCodexConversionConfig(migration.config);
	assert.deepEqual(config.scope.additionalProviders, ["renamed-codex"]);
	assert.equal(config.tools.webRun, false);
	assert.equal(config.tools.imageGeneration, false);
});
