import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	clearFolderCodexConversionConfig,
	getProjectCodexConversionConfigPath,
	materializeFolderCodexConversionConfig,
	readEffectiveCodexConversionConfig,
	setProjectCodexCacheKeepalive,
	writeCodexConversionConfig,
} from "../src/adapter/activation/config-store.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { normalizeFastMode } from "../src/adapter/activation/fast-mode.ts";

test("trusted folder config overrides globals without crossing folder or process boundaries", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-codex-config-"));
	try {
		const globalPath = join(root, "agent", "pi-codex-conversion.json");
		const project = join(root, "project");
		mkdirSync(join(root, "agent"), { recursive: true });
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(globalPath, JSON.stringify({ openai: { cacheKeepalive: true } }));
		assert.equal(readEffectiveCodexConversionConfig({
			cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {},
		}).openai.cacheKeepalive, false);
		assert.equal(setProjectCodexCacheKeepalive(project, true, true).ok, true);
		assert.equal(readEffectiveCodexConversionConfig({
			cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {},
		}).openai.cacheKeepalive, true);

		writeCodexConversionConfig({
			...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
			openai: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.openai,
				fast: normalizeFastMode(false),
				verbosity: "high",
				lunaCacheKeepaliveMinutes: 5,
			},
		}, globalPath);
		writeFileSync(
			getProjectCodexConversionConfigPath(project),
			JSON.stringify({ executionMode: "notebook", openai: { fast: true, lunaCacheKeepaliveMinutes: 15 } }),
		);

		const trusted = readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: {},
		});
		assert.equal(trusted.executionMode, "notebook");
		assert.deepEqual(trusted.openai.fast, normalizeFastMode(true));
		assert.equal(trusted.openai.verbosity, "high");
		assert.equal(trusted.openai.lunaCacheKeepaliveMinutes, 5);
		assert.deepEqual(readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: false,
			globalConfigPath: globalPath,
			env: {},
		}).openai.fast, normalizeFastMode(false));
		assert.deepEqual(readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: { PI_CODEX_FAST: "0" },
		}).openai.fast, normalizeFastMode(false));

		const globalFast = { astra: true, sol: false, terra: true, luna: false, other: true };
		writeFileSync(globalPath, JSON.stringify({ openai: { fast: globalFast } }));
		const projectFast = JSON.stringify({ openai: { fast: { astra: false, luna: true, futureFamily: true } } });
		const projectPathForFast = getProjectCodexConversionConfigPath(project);
		writeFileSync(projectPathForFast, projectFast);
		const fastOptions = { cwd: project, projectTrusted: true, globalConfigPath: globalPath };
		const layeredFast = readEffectiveCodexConversionConfig({ ...fastOptions, env: {} });
		assert.deepEqual(layeredFast.openai.fast, { ...globalFast, astra: false, luna: true },
			"partial folder choices inherit other families");
		for (const [override, enabled] of [["1", true], ["true", true], ["0", false], ["false", false]] as const)
			assert.deepEqual(readEffectiveCodexConversionConfig({ ...fastOptions, env: { PI_CODEX_FAST: override } }).openai.fast,
				normalizeFastMode(enabled), "process force-all wins over each family and the unknown fallback");
		assert.equal(readFileSync(projectPathForFast, "utf8"), projectFast, "process overrides never persist");
		assert.equal(writeCodexConversionConfig(layeredFast, projectPathForFast, true).ok, true);
		assert.equal(JSON.parse(readFileSync(projectPathForFast, "utf8")).openai.fast.futureFamily, true);
		assert.deepEqual(readEffectiveCodexConversionConfig({ ...fastOptions, env: {} }).openai.fast, layeredFast.openai.fast);
		for (const fast of [true, false]) {
			writeFileSync(projectPathForFast, JSON.stringify({ openai: { fast } }));
			assert.deepEqual(readEffectiveCodexConversionConfig({ ...fastOptions, env: {} }).openai.fast, normalizeFastMode(fast),
				"legacy folder booleans override all inherited families");
		}

		const legacyGlobal = JSON.stringify({ compaction: { responsesCompaction: true, portableSummary: true, v2UserMessageRetention: 16 } });
		const legacyProject = JSON.stringify({ compaction: { contextManagement: "tree", hybridCompaction: true, futureOption: "preserve" } });
		const projectPath = getProjectCodexConversionConfigPath(project);
		writeFileSync(globalPath, legacyGlobal);
		writeFileSync(projectPath, legacyProject);
		const migrated = readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} });
		assert.deepEqual(migrated.compaction, { continuity: "notes-and-compaction", historyStorage: "tree", notesTreeHandoff: true, shareSubagentContext: false, idleNotesRollover: false, method: "both", v2UserMessageRetention: 16 });
		assert.equal(readFileSync(globalPath, "utf8"), legacyGlobal);
		assert.equal(readFileSync(projectPath, "utf8"), legacyProject, "startup normalization never writes configuration");
		const explicit = { ...migrated, compaction: { ...migrated.compaction, notesTreeHandoff: false } };
		assert.equal(writeCodexConversionConfig(explicit, projectPath, true).ok, true);
		assert.deepEqual(JSON.parse(readFileSync(projectPath, "utf8")).compaction, {
			...explicit.compaction, futureOption: "preserve",
		}, "explicit writes remove obsolete controls but preserve unknown fields");
		assert.equal(readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} }).compaction.notesTreeHandoff,
			false, "the disabled handoff survives saving and reopening settings");

		const inherited = { continuity: "notes-and-compaction", historyStorage: "local", notesTreeHandoff: false, shareSubagentContext: true, idleNotesRollover: true, method: "both", v2UserMessageRetention: 32 };
		writeFileSync(globalPath, JSON.stringify({ compaction: inherited }));
		for (const { override, expected } of [
			{ override: { contextManagement: "tree", notesTreeHandoff: true }, expected: { historyStorage: "tree", notesTreeHandoff: true } },
			{ override: { portableSummary: false }, expected: { method: "v2" } },
			{
				override: { contextManagement: "tree", portableSummary: false, continuity: "compaction", historyStorage: "remote", method: "pi", shareSubagentContext: false },
				expected: { continuity: "compaction", historyStorage: "remote", method: "pi", shareSubagentContext: false },
			},
		]) {
			writeFileSync(projectPath, JSON.stringify({ compaction: override }));
			const effective = readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} });
			assert.deepEqual(effective.compaction, {
				...inherited, ...expected,
			}, "legacy overrides change only named axes; explicit current fields win");
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("folder scope materializes a full snapshot and returns cleanly to global inheritance", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-codex-config-scope-"));
	try {
		const globalPath = join(root, "agent", "pi-codex-conversion.json");
		const project = join(root, "project");
		const projectPath = getProjectCodexConversionConfigPath(project);
		mkdirSync(join(project, ".pi"), { recursive: true });
		const global = {
			...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, verbosity: "high" as const },
		};
		writeCodexConversionConfig(global, globalPath);
		writeFileSync(projectPath, JSON.stringify({ executionMode: "notebook" }));

		assert.equal(materializeFolderCodexConversionConfig(project, true, globalPath).ok, true);
		const snapshot = JSON.parse(readFileSync(projectPath, "utf8")) as Record<string, unknown>;
		assert.equal(snapshot["executionMode"], "notebook");
		assert.deepEqual(Object.keys(DEFAULT_CODEX_CONVERSION_CONFIG).filter((key) => !(key in snapshot)), []);

		writeCodexConversionConfig({
			...global,
			openai: { ...global.openai, verbosity: "low" },
		}, globalPath);
		assert.equal(readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: {},
		}).openai.verbosity, "high");

		assert.equal(clearFolderCodexConversionConfig(project, true).ok, true);
		assert.equal(existsSync(projectPath), false);
		assert.equal(readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: {},
		}).openai.verbosity, "low");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
