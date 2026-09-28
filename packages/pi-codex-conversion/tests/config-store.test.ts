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
				fast: false,
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
		assert.equal(trusted.openai.fast, true);
		assert.equal(trusted.openai.verbosity, "high");
		assert.equal(trusted.openai.lunaCacheKeepaliveMinutes, 5);
		assert.equal(readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: false,
			globalConfigPath: globalPath,
			env: {},
		}).openai.fast, false);
		assert.equal(readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: { PI_CODEX_FAST: "0" },
		}).openai.fast, false);

		const legacyGlobal = JSON.stringify({ compaction: { responsesCompaction: true, portableSummary: true, v2UserMessageRetention: 16 } });
		const legacyProject = JSON.stringify({ compaction: { contextManagement: "tree", hybridCompaction: true, futureOption: "preserve" } });
		const projectPath = getProjectCodexConversionConfigPath(project);
		writeFileSync(globalPath, legacyGlobal);
		writeFileSync(projectPath, legacyProject);
		const migrated = readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} });
		assert.deepEqual(migrated.compaction, { continuity: "notes-and-compaction", historyStorage: "tree", method: "v2", v2UserMessageRetention: 16 });
		assert.equal(readFileSync(globalPath, "utf8"), legacyGlobal);
		assert.equal(readFileSync(projectPath, "utf8"), legacyProject, "startup normalization never writes configuration");
		assert.equal(writeCodexConversionConfig(migrated, projectPath, true).ok, true);
		assert.deepEqual(JSON.parse(readFileSync(projectPath, "utf8")).compaction, {
			...migrated.compaction, futureOption: "preserve",
		}, "explicit writes remove obsolete controls but preserve unknown fields");

		const inherited = { continuity: "notes-and-compaction", historyStorage: "local", method: "both", v2UserMessageRetention: 32 };
		writeFileSync(globalPath, JSON.stringify({ compaction: inherited }));
		for (const override of [
			{ contextManagement: "tree" },
			{ contextManagement: "tree", method: "pi" },
			{ contextManagement: "tree", continuity: "compaction", historyStorage: "remote" },
		]) {
			writeFileSync(projectPath, JSON.stringify({ compaction: override }));
			const effective = readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} });
			assert.deepEqual(effective.compaction, {
				...inherited, historyStorage: "tree",
				...Object.fromEntries(Object.entries(override).filter(([key]) => key !== "contextManagement")),
			}, "a storage-only legacy override cannot replace the inherited method; new fields win");
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
