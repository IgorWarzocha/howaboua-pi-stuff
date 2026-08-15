import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	clearFolderCodexConversionConfig,
	getProjectCodexConversionConfigPath,
	materializeFolderCodexConversionConfig,
	readEffectiveCodexConversionConfig,
	writeCodexConversionConfig,
} from "../src/adapter/activation/config-store.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";

test("trusted folder config overrides globals without crossing folder or process boundaries", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-codex-config-"));
	try {
		const globalPath = join(root, "agent", "pi-codex-conversion.json");
		const project = join(root, "project");
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeCodexConversionConfig({
			...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
			openai: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.openai,
				fast: false,
				verbosity: "high",
			},
		}, globalPath);
		writeFileSync(
			getProjectCodexConversionConfigPath(project),
			JSON.stringify({ executionMode: "notebook", openai: { fast: true } }),
		);

		const trusted = readEffectiveCodexConversionConfig({
			cwd: project,
			projectTrusted: true,
			globalConfigPath: globalPath,
			env: {},
		});
		assert.equal(trusted.openai.fast, true);
		assert.equal(trusted.openai.verbosity, "high");
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
		assert.deepEqual(JSON.parse(readFileSync(projectPath, "utf8")), { executionMode: "notebook" });
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
