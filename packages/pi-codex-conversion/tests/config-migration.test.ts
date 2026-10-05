import test from "node:test";
import assert from "node:assert/strict";
import { migrateCodexConversionConfigIfNeeded } from "../src/adapter/activation/config-migration.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG, normalizeCodexConversionConfig } from "../src/adapter/activation/config.ts";

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
	assert.deepEqual(normalized.openai.fast, { astra: true, sol: true, terra: true, luna: true, other: true });
	for (const fast of [true, false]) {
		assert.deepEqual(normalizeCodexConversionConfig({ openai: { fast } }).openai.fast,
			{ astra: fast, sol: fast, terra: fast, luna: fast, other: fast },
			"grouped legacy booleans preserve Fast Mode for known and unknown models");
	}
	assert.deepEqual(normalizeCodexConversionConfig({ openai: { fast: { astra: true, sol: "true", terra: null, luna: false } } }).openai.fast,
		{ astra: true, sol: false, terra: false, luna: false, other: false });
	assert.equal(normalizeCodexConversionConfig({ ui: { compactTools: true } }).ui.compactTools, "on");
	assert.equal(normalizeCodexConversionConfig({ ui: { compactTools: false } }).ui.compactTools, "off");
	for (const notesTreeHandoff of [undefined, null, "off", 1])
		assert.equal(normalizeCodexConversionConfig({ compaction: { notesTreeHandoff } }).compaction.notesTreeHandoff, true,
			"absent or invalid tree handoff settings preserve the existing policy");
	assert.equal(normalizeCodexConversionConfig({ compaction: { notesTreeHandoff: false } }).compaction.notesTreeHandoff, false);
	assert.equal(migrateCodexConversionConfigIfNeeded({ compaction: { notesTreeHandoff: false } }).migrated, false,
		"the independent toggle needs no migration");

	const code = migrateCodexConversionConfigIfNeeded({ beta: { codeMode: true, responsesLite: false } });
	assert.equal(code.migrated, true);
	assert.deepEqual(code.config, {
		executionMode: "code",
		openai: { proxyResponsesLite: false },
		compaction: { v2UserMessageRetention: 64 },
	});

	for (const contextManagement of ["off", "local", "tree", "remote"] as const) {
		for (const hybridCompaction of [false, true]) {
			const legacy = { compaction: { contextManagement, hybridCompaction, responsesCompaction: true, portableSummary: true, v2UserMessageRetention: 32 } };
			const migration = migrateCodexConversionConfigIfNeeded(legacy);
			assert.equal(migration.migrated, true);
			assert.deepEqual(normalizeCodexConversionConfig(migration.config).compaction, {
				continuity: contextManagement === "off" ? "compaction" : hybridCompaction ? "notes-and-compaction" : "notes",
				historyStorage: contextManagement === "off" ? "local" : contextManagement,
				notesTreeHandoff: true,
				shareSubagentContext: false,
				idleNotesRollover: false,
				method: contextManagement === "off" || hybridCompaction ? "both" : "pi",
				v2UserMessageRetention: 32,
			});
			assert.equal(migrateCodexConversionConfigIfNeeded(migration.config).migrated, false);
			assert.equal(legacy.compaction.contextManagement, contextManagement, "reading must not mutate the source document");
		}
	}
	for (const responsesCompaction of [false, true]) {
		assert.equal(normalizeCodexConversionConfig(migrateCodexConversionConfigIfNeeded({ responsesCompaction }).config).compaction.method,
			responsesCompaction ? "v2" : "pi");
	}
	const current = { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, continuity: "notes-and-compaction" as const, method: "both" as const, notesTreeHandoff: false };
	assert.deepEqual(normalizeCodexConversionConfig(migrateCodexConversionConfigIfNeeded({ compaction: {
		...current, contextManagement: "off", responsesCompaction: false,
	} }).config).compaction, current, "explicit current fields win over stale legacy options");
});
