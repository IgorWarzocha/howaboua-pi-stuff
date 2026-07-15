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
	assert.deepEqual(config.scope, { allProviders: "on", additionalProviders: [] });
	assert.deepEqual(config.tools, { webRun: false, imageGeneration: false, viewImageFallback: false, applyPatchOnly: true, viewImageOnly: false, webRunOnly: false, imageGenerationOnly: false });
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
	assert.equal(config.openai.webSearchModel, "gpt-5.6-luna");
	assert.equal(config.openai.compactionModel, "gpt-5.5");
	assert.equal(config.openai.compactionReasoning, "medium");
});

test("new config defaults to GPT-5.6 Luna and accepts max compaction reasoning", () => {
	const config = normalizeCodexConversionConfig({ openai: { compactionReasoning: "max" } });
	assert.equal(config.openai.webSearchModel, "gpt-5.6-luna");
	assert.equal(config.openai.compactionModel, "gpt-5.6-luna");
	assert.equal(config.openai.compactionReasoning, "max");
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

test("grouped config accepts old toolRendering key", () => {
	const config = normalizeCodexConversionConfig({ ui: { toolRendering: false, compactTools: true } });
	assert.equal(config.ui.toolRenaming, false);
	assert.equal(config.ui.compactTools, true);
});

test("GPT-5.6 Code Mode is opt-in", () => {
	assert.equal(normalizeCodexConversionConfig({}).beta.codeMode, false);
	assert.equal(normalizeCodexConversionConfig({ beta: { codeMode: true } }).beta.codeMode, true);
	assert.equal(normalizeCodexConversionConfig({}).beta.responsesLite, false);
	assert.equal(normalizeCodexConversionConfig({ beta: { codeMode: true, responsesLite: true } }).beta.responsesLite, true);
});

test("Code Mode details are optional", () => {
	assert.equal(normalizeCodexConversionConfig({}).ui.codeModeDetails, false);
	assert.equal(normalizeCodexConversionConfig({ ui: { codeModeDetails: true } }).ui.codeModeDetails, true);
});

test("legacy Responses Lite config enables Code Mode without opting proxies into Lite", () => {
	const migration = migrateCodexConversionConfigIfNeeded({
		beta: { responsesLite: true },
	});
	assert.equal(migration.migrated, true);
	assert.deepEqual((migration.config as { beta: unknown }).beta, { codeMode: true, responsesLite: false });
});

test("beta-only Code Mode config stays grouped", () => {
	const migration = migrateCodexConversionConfigIfNeeded({ beta: { codeMode: true } });
	assert.equal(migration.migrated, false);
	assert.equal(normalizeCodexConversionConfig(migration.config).beta.codeMode, true);
});
