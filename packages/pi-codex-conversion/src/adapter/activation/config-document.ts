import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CODEX_CONVERSION_CONFIG, type CodexConversionConfig } from "./config.ts";

export const OWNED_CONFIG_KEYS = Object.keys(DEFAULT_CODEX_CONVERSION_CONFIG);
export const LEGACY_OWNED_CONFIG_KEYS = ["beta"];

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function mergeConfigDocument(existing: Record<string, unknown>, owned: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...existing };
	for (const [key, value] of Object.entries(owned)) {
		const previous = merged[key];
		merged[key] = isRecord(previous) && isRecord(value)
			? mergeConfigDocument(previous, value)
			: value;
	}
	return merged;
}

export function clearAbsentOwnedOptionals(document: Record<string, unknown>, owned: Record<string, unknown>, folderScope: boolean): void {
	const voice = isRecord(document["voice"]) ? document["voice"] : undefined;
	const ownedVoice = isRecord(owned["voice"]) ? owned["voice"] : undefined;
	if (!voice || !ownedVoice) return;
	for (const key of ["contextModel", "inputDevice", "outputDevice"])
		if (!(key in ownedVoice)) {
			// A project-level Off must override a globally selected summary model.
			if (folderScope && key === "contextModel") voice[key] = null;
			else delete voice[key];
		}
}

export function writeConfigDocumentAtomic(configPath: string, document: Record<string, unknown>): void {
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

export function withoutProjectOnlyConfig(config: CodexConversionConfig): CodexConversionConfig {
	return {
		...config,
		openai: { ...config.openai, cacheKeepalive: false, cacheKeepaliveIntervalMinutes: 25 },
	};
}

export function withoutProjectOnlyDocument(document: Record<string, unknown>): Record<string, unknown> {
	const openai = isRecord(document["openai"]) ? { ...document["openai"] } : undefined;
	if (!openai) return document;
	delete openai["cacheKeepalive"];
	delete openai["cacheKeepaliveIntervalMinutes"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

export function withoutGlobalOnlyDocument(document: Record<string, unknown>): Record<string, unknown> {
	const notebook = isRecord(document["notebook"]) ? { ...document["notebook"] } : undefined;
	if (notebook) delete notebook["journals"];
	if (notebook) delete notebook["checkpointCleanup"];
	document = notebook ? { ...document, notebook } : document;
	const openai = isRecord(document["openai"]) ? { ...document["openai"] } : undefined;
	if (!openai) return document;
	delete openai["lunaCacheKeepaliveMinutes"];
	delete openai["lunaCacheKeepaliveIntervalMinutes"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

export function withoutDisabledProjectCacheKeepalive(document: Record<string, unknown>): Record<string, unknown> {
	const openai = isRecord(document["openai"]) ? { ...document["openai"] } : undefined;
	if (!openai || openai["cacheKeepalive"] !== false) return document;
	delete openai["cacheKeepalive"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}
