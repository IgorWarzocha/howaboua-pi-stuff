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
	assert.equal(normalizeCodexConversionConfig({ ui: { compactTools: true } }).ui.compactTools, "on");
	assert.equal(normalizeCodexConversionConfig({ ui: { compactTools: false } }).ui.compactTools, "off");

	const code = migrateCodexConversionConfigIfNeeded({ beta: { codeMode: true, responsesLite: false } });
	assert.equal(code.migrated, true);
	assert.deepEqual(code.config, {
		executionMode: "code",
		openai: { proxyResponsesLite: false },
		compaction: { v2UserMessageRetention: 64 },
	});
});
