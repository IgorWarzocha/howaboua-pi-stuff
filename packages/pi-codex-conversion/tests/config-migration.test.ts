import test from "node:test";
import assert from "node:assert/strict";
import { migrateCodexConversionConfigIfNeeded } from "../src/adapter/activation/config-migration.ts";
import { normalizeCodexConversionConfig } from "../src/adapter/activation/config.ts";
import { CODEX_CONVERSION_CONFIG_BASENAME } from "../src/adapter/activation/config-store.ts";

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
	});
	assert.equal(migration.migrated, true);
	const config = normalizeCodexConversionConfig(migration.config);
	assert.deepEqual(config.scope, { allProviders: "on", additionalProviders: [] });
	assert.deepEqual(config.tools, { customRustBinariesDir: "", webRun: false, imageGeneration: false, viewImageFallback: false, applyPatchOnly: true, viewImageOnly: false, webRunOnly: false, imageGenerationOnly: false });
	assert.equal(config.ui.statusLine, false);
	assert.equal(config.ui.toolRenaming, true);
	assert.equal(config.ui.compactTools, false);
	assert.equal(config.ui.codeModeDetails, false);
	assert.equal(config.ui.backgroundShellWidget, false);
	assert.equal(config.compaction.responsesCompaction, true);
	assert.equal(config.beta.codeMode, false);
	assert.equal(config.beta.responsesLite, false);
	assert.equal(config.openai.fast, true);
	assert.equal(config.openai.verbosity, "high");
	assert.equal(config.openai.forceCachedWebSockets, false);
	assert.equal(config.openai.cacheDiagnostics, "off");
	assert.equal(config.openai.harnessIdentifierHeader, false);
	assert.equal(config.openai.webSearchModel, "gpt-5.6-luna");
});

test("legacy Responses Lite config enables Code Mode without opting proxies into Lite", () => {
	const migration = migrateCodexConversionConfigIfNeeded({
		beta: { responsesLite: true },
	});
	assert.equal(migration.migrated, true);
	assert.deepEqual((migration.config as { beta: unknown }).beta, { codeMode: true, responsesLite: false });
});

test("legacy PATH mode and unknown fields normalize as ordinary structured-tool config", () => {
	const config = normalizeCodexConversionConfig({
		mode: "path",
		unknownOldField: true,
		tools: { webRun: false },
	});
	assert.equal(config.tools.webRun, false);
	assert.equal("mode" in config, false);
	assert.equal(CODEX_CONVERSION_CONFIG_BASENAME, "pi-codex-conversion.json");
});
