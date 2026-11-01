import { CODEX_CONVERSION_CONFIG_BASENAME } from "./config-file.ts";
import { OWNED_CONFIG_KEYS, LEGACY_OWNED_CONFIG_KEYS, isRecord, mergeConfigDocument, writeConfigDocumentAtomic, withoutGlobalOnlyDocument } from "./config-document.ts";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { migrateCodexConversionConfigIfNeeded, type CompactionMigrationInheritance } from "./config-migration.ts";
import { normalizeCodexConversionConfig, type CodexConversionConfig, type LunaCacheKeepaliveMinutes, type LunaCacheKeepaliveIntervalMinutes, type CacheKeepaliveIntervalMinutes } from "./config.ts";
import { readCodexCacheEnvironment } from "./cache-environment.ts";
import { normalizeFastMode } from "./fast-mode.ts";
import { readConfigDocument, normalizeGlobalConfigDocument, readCodexConversionConfig as readFileConfig, writeCodexConversionConfig as writeFileConfig } from "./config-file.ts";

export function readCodexConversionConfig(configPath = getCodexConversionConfigPath()): CodexConversionConfig {
	return readFileConfig(configPath);
}
export function writeCodexConversionConfig(config: CodexConversionConfig, configPath = getCodexConversionConfigPath(), folderScope = false) {
	return writeFileConfig(config, configPath, folderScope);
}

// Lite deliberately shares the original package's config so replacing either
// package does not require a reset or a second settings file.
export { CODEX_CONVERSION_CONFIG_BASENAME } from "./config-file.ts";

export interface EffectiveCodexConversionConfigOptions {
	cwd: string;
	projectTrusted: boolean;
	globalConfigPath?: string | undefined;
	env?: NodeJS.ProcessEnv | undefined;
}

export type CodexConversionConfigScope = "global" | "folder";

export function getCodexConversionConfigPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, CODEX_CONVERSION_CONFIG_BASENAME);
}

export function getProjectCodexConversionConfigPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, CODEX_CONVERSION_CONFIG_BASENAME);
}

/** Read before normalization drops settings now owned by Notes. */
export function readLegacyCodexNotesConfig(options: Omit<EffectiveCodexConversionConfigOptions, "env">): { path: string; continuity: string } | undefined {
	const paths = [options.globalConfigPath ?? getCodexConversionConfigPath()];
	if (options.projectTrusted) paths.push(getProjectCodexConversionConfigPath(options.cwd));
	let selected: { path: string; continuity: unknown } | undefined;
	for (const [index, path] of paths.entries()) {
		const document = readConfigDocument(path, index === 0 ? "global" : "trusted project");
		const compaction = isRecord(document) && isRecord(document["compaction"]) ? document["compaction"] : undefined;
		if (!compaction) continue;
		// Older releases translated these fields only in memory, not on disk.
		const mode = compaction["contextManagement"];
		const modeOverride = mode === "off" || mode === "local" || mode === "tree" || mode === "remote";
		const inheritedNotes = selected?.continuity === "notes" || selected?.continuity === "notes-and-compaction";
		const notes = modeOverride ? mode !== "off" : inheritedNotes;
		const hybrid = typeof compaction["hybridCompaction"] === "boolean"
			? compaction["hybridCompaction"] : selected?.continuity === "notes-and-compaction";
		if (modeOverride || (notes && typeof compaction["hybridCompaction"] === "boolean"))
			selected = { path, continuity: notes ? hybrid ? "notes-and-compaction" : "notes" : "compaction" };
		// Explicit current fields override the legacy translation in the same scope.
		if ("continuity" in compaction) selected = { path, continuity: compaction["continuity"] };
	}
	return selected && (selected.continuity === "notes" || selected.continuity === "notes-and-compaction")
		? { path: selected.path, continuity: selected.continuity }
		: undefined;
}

export function readProjectCodexConversionDocument(
	cwd: string,
	projectTrusted: boolean,
	inheritedCompaction?: CompactionMigrationInheritance,
): Record<string, unknown> | undefined {
	if (!projectTrusted) return undefined;
	const path = getProjectCodexConversionConfigPath(cwd);
	const parsed = readConfigDocument(path, "trusted project");
	if (!isRecord(parsed)) return undefined;
	const migration = migrateCodexConversionConfigIfNeeded(parsed, inheritedCompaction);
	return isRecord(migration.config) ? withoutGlobalOnlyDocument(migration.config) : undefined;
}

export function hasFolderCodexConversionConfig(cwd: string, projectTrusted: boolean): boolean {
	const project = readProjectCodexConversionDocument(cwd, projectTrusted);
	if (!project) return false;
	return [...OWNED_CONFIG_KEYS, ...LEGACY_OWNED_CONFIG_KEYS].some((key) => {
		if (key !== "openai") return key in project;
		const openai = isRecord(project["openai"]) ? project["openai"] : undefined;
		return !!openai && Object.keys(openai).some((option) => option !== "cacheKeepalive" && option !== "cacheKeepaliveIntervalMinutes");
	});
}

function applyProcessOverrides(config: CodexConversionConfig, env: NodeJS.ProcessEnv): CodexConversionConfig {
	const cacheEnvironment = readCodexCacheEnvironment(env);
	const fast = env["PI_CODEX_FAST"]?.trim().toLowerCase();
	const fastOverride = fast === "ultrafast" ? "ultrafast" : fast === "1" || fast === "true"
		? true
		: fast === "0" || fast === "false"
			? false
			: undefined;
	if (
		fastOverride === undefined
		&& cacheEnvironment.diagnostics === undefined
	) return config;
	return {
		...config,
		openai: {
			...config.openai,
			...(fastOverride !== undefined ? { fast: normalizeFastMode(fastOverride) } : {}),
			...(cacheEnvironment.diagnostics !== undefined
				? { cacheDiagnostics: cacheEnvironment.diagnostics }
				: {}),
		},
	};
}

export function readEffectiveCodexConversionConfig(options: EffectiveCodexConversionConfigOptions): CodexConversionConfig {
	const layered = readLayeredCodexConversionConfig(options);
	return applyProcessOverrides(layered, options.env ?? process.env);
}

export function readLayeredCodexConversionConfig(
	options: Omit<EffectiveCodexConversionConfigOptions, "env">,
): CodexConversionConfig {
	const document = readConfigDocument(options.globalConfigPath ?? getCodexConversionConfigPath(), "global");
	const global = normalizeGlobalConfigDocument(document);
	// Legacy project options can inherit continuity axes normalization no longer owns.
	const legacyCompaction = isRecord(document) && isRecord(document["compaction"]) ? document["compaction"] : {};
	const project = readProjectCodexConversionDocument(options.cwd, options.projectTrusted, { ...global.compaction, ...legacyCompaction });
	return project
		? normalizeCodexConversionConfig(mergeConfigDocument(global as unknown as Record<string, unknown>, project))
		: global;
}

export function setProjectCodexCacheKeepalive(
	cwd: string,
	projectTrusted: boolean,
	enabled: boolean,
	intervalMinutes?: CacheKeepaliveIntervalMinutes,
): { ok: true } | { ok: false; error: string } {
	if (!projectTrusted) return { ok: false, error: "Trust this folder before changing project cache keepalive" };
	const path = getProjectCodexConversionConfigPath(cwd);
	try {
		const existing = readConfigDocument(path, "trusted project");
		if (existsSync(path) && !isRecord(existing)) return { ok: false, error: "Project config is not a JSON object" };
		const document = isRecord(existing) ? existing : {};
		const openai = isRecord(document["openai"]) ? { ...document["openai"] } : {};
		if (enabled) openai["cacheKeepalive"] = true;
		else delete openai["cacheKeepalive"];
		if (intervalMinutes !== undefined) openai["cacheKeepaliveIntervalMinutes"] = intervalMinutes;
		if (Object.keys(openai).length > 0) document["openai"] = openai;
		else delete document["openai"];
		if (Object.keys(document).length === 0) rmSync(path, { force: true });
		else writeConfigDocumentAtomic(path, document);
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to write project cache keepalive ${path}: ${message}`);
		return { ok: false, error: message };
	}
}

export function setGlobalCodexLunaCacheKeepalive(
	minutes: LunaCacheKeepaliveMinutes,
	globalConfigPath: string = getCodexConversionConfigPath(),
	intervalMinutes?: LunaCacheKeepaliveIntervalMinutes,
): { ok: true; warning?: string } | { ok: false; error: string } {
	const config = readCodexConversionConfig(globalConfigPath);
	return writeCodexConversionConfig({
		...config,
		openai: { ...config.openai, lunaCacheKeepaliveMinutes: minutes,
			...(intervalMinutes !== undefined ? { lunaCacheKeepaliveIntervalMinutes: intervalMinutes } : {}) },
	}, globalConfigPath);
}

export function materializeFolderCodexConversionConfig(
	cwd: string,
	projectTrusted: boolean,
	globalConfigPath?: string | undefined,
): { ok: true; config: CodexConversionConfig } | { ok: false; error: string } {
	if (!projectTrusted) return { ok: false, error: "Trust this folder before enabling folder settings" };
	const config = readLayeredCodexConversionConfig({ cwd, projectTrusted, globalConfigPath });
	const result = writeCodexConversionConfig(config, getProjectCodexConversionConfigPath(cwd), true);
	return result.ok ? { ok: true, config } : result;
}

export function clearFolderCodexConversionConfig(
	cwd: string,
	projectTrusted: boolean,
): { ok: true } | { ok: false; error: string } {
	if (!projectTrusted) return { ok: false, error: "Trust this folder before changing folder settings" };
	const path = getProjectCodexConversionConfigPath(cwd);
	const project = readProjectCodexConversionDocument(cwd, true);
	if (!project) return { ok: true };
	for (const key of [...OWNED_CONFIG_KEYS, ...LEGACY_OWNED_CONFIG_KEYS]) {
		if (key === "openai" && isRecord(project[key])) {
			const keepalive = project[key]["cacheKeepalive"];
			const interval = project[key]["cacheKeepaliveIntervalMinutes"];
			const nextOpenAI = {
				...(keepalive === true ? { cacheKeepalive: true } : {}),
				...(interval === 25 || interval === 55 ? { cacheKeepaliveIntervalMinutes: interval } : {}),
			};
			if (Object.keys(nextOpenAI).length === 0) delete project[key];
			else project[key] = nextOpenAI;
			continue;
		}
		delete project[key];
	}
	try {
		if (Object.keys(project).length === 0) rmSync(path, { force: true });
		else writeConfigDocumentAtomic(path, project);
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to clear folder config ${path}: ${message}`);
		return { ok: false, error: message };
	}
}
