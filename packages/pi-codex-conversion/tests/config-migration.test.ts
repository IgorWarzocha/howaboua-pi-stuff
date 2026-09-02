import test from "node:test";
import assert from "node:assert/strict";
import { migrateCodexConversionConfigIfNeeded } from "../src/adapter/activation/config-migration.ts";
import { normalizeCodexConversionConfig } from "../src/adapter/activation/config.ts";

test("legacy persisted config shapes migrate to the current groups", () => {
	const flat = migrateCodexConversionConfigIfNeeded({
		useOnAllModels: true,
		useAdapterProviders: false,
		adapterProviders: ["ignored-provider"],
		fast: true,
	});
	assert.equal(flat.migrated, true);
	const normalized = normalizeCodexConversionConfig(flat.config);
	assert.deepEqual(normalized.scope, { allProviders: "on", additionalProviders: [] });
	assert.equal(normalized.openai.fast, true);

	const code = migrateCodexConversionConfigIfNeeded({ beta: { codeMode: true, responsesLite: false } });
	assert.equal(code.migrated, true);
	assert.deepEqual(code.config, {
		executionMode: "code",
		openai: { proxyResponsesLite: false },
		compaction: { v2UserMessageRetention: 64 },
	});
	assert.equal(normalizeCodexConversionConfig(code.config).compaction.portableSummary, false);
	assert.equal(normalizeCodexConversionConfig({ compaction: { portableSummary: true } }).compaction.portableSummary, false);
	assert.equal(normalizeCodexConversionConfig({
		compaction: { responsesCompaction: true, portableSummary: true },
	}).compaction.portableSummary, true);
	assert.equal(normalizeCodexConversionConfig({
		voice: { refreshRealtimeAfterCompaction: true },
	}).voice.refreshRealtimeAfterCompaction, false);
	assert.equal(normalizeCodexConversionConfig({
		voice: {
			contextModel: { provider: "openai-codex", modelId: "gpt-5.6-luna" },
			refreshRealtimeAfterCompaction: true,
		},
	}).voice.refreshRealtimeAfterCompaction, true);
});

test("Notebook heap configuration is bounded without migrating grouped config", () => {
	const accepted = migrateCodexConversionConfigIfNeeded({ notebook: { maxHeapMiB: 8192, profile: "shell-agent" } });
	assert.equal(accepted.migrated, false);
	assert.equal(normalizeCodexConversionConfig(accepted.config).notebook.maxHeapMiB, 8192);
	assert.equal(normalizeCodexConversionConfig(accepted.config).notebook.profile, "shell-agent");
	assert.equal(normalizeCodexConversionConfig({ notebook: { maxHeapMiB: 128 } }).notebook.maxHeapMiB, 4096);
	assert.equal(normalizeCodexConversionConfig({ notebook: { profile: "../nope" } }).notebook.profile, undefined);
});
