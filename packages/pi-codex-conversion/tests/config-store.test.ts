import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	clearFolderCodexConversionConfig,
	getProjectCodexConversionConfigPath,
	hasFolderCodexConversionConfig,
	materializeFolderCodexConversionConfig,
	readEffectiveCodexConversionConfig,
	setGlobalCodexLunaCacheKeepalive,
	setProjectCodexCacheKeepalive,
	writeCodexConversionConfig,
} from "../src/adapter/activation/config-store.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";

test("trusted folder config overrides globals without crossing folder or process boundaries", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-codex-config-"));
	try {
		const globalPath = join(root, "agent", "pi-codex-conversion.json");
		const project = join(root, "project");
		const projectPath = getProjectCodexConversionConfigPath(project);
		mkdirSync(join(root, "agent"), { recursive: true });
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(globalPath, JSON.stringify({ openai: { cacheKeepalive: true, lunaCacheKeepaliveMinutes: 10 } }), { encoding: "utf8" });

		assert.equal(readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} }).openai.cacheKeepalive, false);
		assert.equal(readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} }).openai.lunaCacheKeepaliveMinutes, 10);
		assert.equal(setGlobalCodexLunaCacheKeepalive(5, globalPath).ok, true);
		assert.equal(readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} }).openai.lunaCacheKeepaliveMinutes, 5);
		assert.equal(setProjectCodexCacheKeepalive(project, true, true).ok, true);
		assert.deepEqual(JSON.parse(readFileSync(projectPath, "utf8")), { openai: { cacheKeepalive: true } });
		assert.equal(hasFolderCodexConversionConfig(project, true), false);
		assert.equal(readEffectiveCodexConversionConfig({ cwd: project, projectTrusted: true, globalConfigPath: globalPath, env: {} }).openai.cacheKeepalive, true);
		assert.equal(setProjectCodexCacheKeepalive(project, true, false).ok, true);
		assert.equal(existsSync(projectPath), false);

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
		const experiment = readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: {
				PI_CODEX_CACHE_KEEPALIVE: "generated-current",
				PI_CODEX_CACHE_DIAGNOSTICS: "status-and-log",
			},
		});
		assert.equal(experiment.openai.cacheKeepalive, false);
		assert.equal(experiment.openai.cacheDiagnostics, "status-and-log");
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
