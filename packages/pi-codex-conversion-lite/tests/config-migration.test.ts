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
	assert.equal(config.openai.harnessIdentifierHeader, false);
	assert.equal(config.openai.webSearchModel, "gpt-5.6-luna");
});

test("voice preferences normalize protocol and mode independently", () => {
	const config = normalizeCodexConversionConfig({
		voiceFeaturesOnly: true,
		voice: {
			protocol: "v2",
			mode: "transcription",
			v2Voice: "cedar",
			v3Voice: "sol",
			dictationShortcut: " alt+x ",
			realtimeShortcut: "ctrl+alt+r",
			dictationShortcutMode: "toggle",
			inputDevice: "  mic-1  ",
			outputDevice: "speaker-1",
		},
	});
	assert.equal(config.voiceFeaturesOnly, true);
	assert.deepEqual(config.voice, {
		protocol: "v2",
		mode: "transcription",
		v2Voice: "cedar",
		v3Voice: "sol",
		dictationShortcut: "alt+x",
		realtimeShortcut: "ctrl+alt+r",
		dictationShortcutMode: "toggle",
		inputDevice: "mic-1",
		outputDevice: "speaker-1",
	});

	const invalid = normalizeCodexConversionConfig({
		voice: { protocol: "v1", mode: "voice", v2Voice: "cove", v3Voice: "marin" },
	});
	assert.deepEqual(invalid.voice, {
		protocol: "v3",
		mode: "conversational",
		v2Voice: "marin",
		v3Voice: "cove",
		dictationShortcut: "ctrl+alt+d",
		realtimeShortcut: "ctrl+alt+space",
		dictationShortcutMode: "push",
	});
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
