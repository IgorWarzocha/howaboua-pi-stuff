import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { migrateCodexConversionConfigIfNeeded } from "./config-migration.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG, normalizeCodexConversionConfig, type CodexConversionConfig, type LunaCacheKeepaliveMinutes } from "./config.ts";
import { readCodexCacheEnvironment } from "./cache-environment.ts";

// Lite deliberately shares the original package's config so replacing either
// package does not require a reset or a second settings file.
export const CODEX_CONVERSION_CONFIG_BASENAME = "pi-codex-conversion.json";

export interface EffectiveCodexConversionConfigOptions {
	cwd: string;
	projectTrusted: boolean;
	globalConfigPath?: string | undefined;
	env?: NodeJS.ProcessEnv | undefined;
}

export type CodexConversionConfigScope = "global" | "folder";

const OWNED_CONFIG_KEYS = Object.keys(DEFAULT_CODEX_CONVERSION_CONFIG);
const LEGACY_OWNED_CONFIG_KEYS = ["beta"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfigDocument(existing: Record<string, unknown>, owned: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...existing };
	for (const [key, value] of Object.entries(owned)) {
		const previous = merged[key];
		merged[key] = isRecord(previous) && isRecord(value)
			? mergeConfigDocument(previous, value)
			: value;
	}
	return merged;
}

function clearAbsentOwnedOptionals(document: Record<string, unknown>, owned: Record<string, unknown>): void {
	const voice = isRecord(document["voice"]) ? document["voice"] : undefined;
	const ownedVoice = isRecord(owned["voice"]) ? owned["voice"] : undefined;
	if (!voice || !ownedVoice) return;
	for (const key of ["contextModel", "inputDevice", "outputDevice"])
		if (!(key in ownedVoice)) delete voice[key];
}

function writeConfigDocumentAtomic(configPath: string, document: Record<string, unknown>): void {
	const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
	mkdirSync(dirname(configPath), { recursive: true });
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
		});
		renameSync(temporaryPath, configPath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function withoutProjectOnlyConfig(config: CodexConversionConfig): CodexConversionConfig {
	return {
		...config,
		openai: { ...config.openai, cacheKeepalive: false },
	};
}

function withoutProjectOnlyDocument(document: Record<string, unknown>): Record<string, unknown> {
	const openai = isRecord(document["openai"]) ? { ...document["openai"] } : undefined;
	if (!openai) return document;
	delete openai["cacheKeepalive"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

function withoutGlobalOnlyDocument(document: Record<string, unknown>): Record<string, unknown> {
	const openai = isRecord(document["openai"]) ? { ...document["openai"] } : undefined;
	if (!openai) return document;
	delete openai["lunaCacheKeepaliveMinutes"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

function withoutDisabledProjectCacheKeepalive(document: Record<string, unknown>): Record<string, unknown> {
	const openai = isRecord(document["openai"]) ? { ...document["openai"] } : undefined;
	if (!openai || openai["cacheKeepalive"] !== false) return document;
	delete openai["cacheKeepalive"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

export function getCodexConversionConfigPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, CODEX_CONVERSION_CONFIG_BASENAME);
}

export function getProjectCodexConversionConfigPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, CODEX_CONVERSION_CONFIG_BASENAME);
}

function readConfigDocument(configPath: string, scope: "global" | "trusted project"): unknown | undefined {
	if (!existsSync(configPath)) return undefined;
	try {
		return JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to read ${scope} config ${configPath}: ${message}`);
		return undefined;
	}
}

export function readCodexConversionConfig(configPath: string = getCodexConversionConfigPath()): CodexConversionConfig {
	const parsed = readConfigDocument(configPath, "global");
	if (parsed === undefined) return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	const migration = migrateCodexConversionConfigIfNeeded(parsed);
	const config = withoutProjectOnlyConfig(normalizeCodexConversionConfig(migration.config));
	const voice = isRecord(parsed) && isRecord(parsed["voice"])
		? parsed["voice"]
		: undefined;
	if (typeof voice?.["audioSetupCompleted"] !== "boolean")
		config.voice.audioSetupCompleted = true;
	return config;
}

export function readProjectCodexConversionDocument(cwd: string, projectTrusted: boolean): Record<string, unknown> | undefined {
	if (!projectTrusted) return undefined;
	const path = getProjectCodexConversionConfigPath(cwd);
	const parsed = readConfigDocument(path, "trusted project");
	if (!isRecord(parsed)) return undefined;
	const migration = migrateCodexConversionConfigIfNeeded(parsed);
	return isRecord(migration.config) ? withoutGlobalOnlyDocument(migration.config) : undefined;
}

export function hasFolderCodexConversionConfig(cwd: string, projectTrusted: boolean): boolean {
	const project = readProjectCodexConversionDocument(cwd, projectTrusted);
	if (!project) return false;
	return [...OWNED_CONFIG_KEYS, ...LEGACY_OWNED_CONFIG_KEYS].some((key) => {
		if (key !== "openai") return key in project;
		const openai = isRecord(project["openai"]) ? project["openai"] : undefined;
		return !!openai && Object.keys(openai).some((option) => option !== "cacheKeepalive");
	});
}

function applyProcessOverrides(config: CodexConversionConfig, env: NodeJS.ProcessEnv): CodexConversionConfig {
	const cacheEnvironment = readCodexCacheEnvironment(env);
	const fast = env["PI_CODEX_FAST"]?.trim().toLowerCase();
	const fastOverride = fast === "1" || fast === "true"
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
			...(fastOverride !== undefined ? { fast: fastOverride } : {}),
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
	const global = readCodexConversionConfig(options.globalConfigPath);
	const project = readProjectCodexConversionDocument(options.cwd, options.projectTrusted);
	return project
		? normalizeCodexConversionConfig(mergeConfigDocument(global as unknown as Record<string, unknown>, project))
		: global;
}

export function setProjectCodexCacheKeepalive(
	cwd: string,
	projectTrusted: boolean,
	enabled: boolean,
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
): { ok: true } | { ok: false; error: string } {
	const config = readCodexConversionConfig(globalConfigPath);
	return writeCodexConversionConfig({
		...config,
		openai: { ...config.openai, lunaCacheKeepaliveMinutes: minutes },
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
			const nextOpenAI = keepalive === true ? { cacheKeepalive: true } : {};
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

export function writeCodexConversionConfig(
	config: CodexConversionConfig,
	configPath: string = getCodexConversionConfigPath(),
	folderScope = false,
): { ok: true } | { ok: false; error: string } {
	try {
		const normalizedConfig = normalizeCodexConversionConfig(config) as unknown as Record<string, unknown>;
		const normalized = folderScope
			? withoutDisabledProjectCacheKeepalive(withoutGlobalOnlyDocument(normalizedConfig))
			: withoutProjectOnlyDocument(normalizedConfig);
		let document = normalized;
		if (existsSync(configPath)) {
			try {
				const existing = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
				if (isRecord(existing)) document = mergeConfigDocument(existing, normalized);
			} catch {
				// A valid explicit settings write replaces an unreadable document.
			}
		}
		document = folderScope
			? withoutDisabledProjectCacheKeepalive(withoutGlobalOnlyDocument(document))
			: withoutProjectOnlyDocument(document);
		clearAbsentOwnedOptionals(document, normalized);
		for (const key of LEGACY_OWNED_CONFIG_KEYS) delete document[key];
		writeConfigDocumentAtomic(configPath, document);
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to write ${configPath}: ${message}`);
		return { ok: false, error: message };
	}
}
