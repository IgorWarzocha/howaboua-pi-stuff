import { existsSync, readFileSync } from "node:fs";
import {
	LEGACY_OWNED_CONFIG_KEYS,
	isRecord,
	mergeConfigDocument,
	clearAbsentOwnedOptionals,
	writeConfigDocumentAtomic,
	withoutProjectOnlyConfig,
	withoutProjectOnlyDocument,
	withoutGlobalOnlyDocument,
	withoutDisabledProjectCacheKeepalive,
} from "./config-document.ts";
import { migrateCodexConversionConfigIfNeeded } from "./config-migration.ts";
import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	normalizeCodexConversionConfig,
	type CodexConversionConfig,
} from "./config.ts";

export function readConfigDocument(
	configPath: string,
	scope: "global" | "trusted project",
	strict = false,
): unknown | undefined {
	if (!existsSync(configPath)) return undefined;
	try {
		const document: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
		if (strict && !isRecord(document))
			throw new Error("Expected a JSON object");
		return document;
	} catch (error) {
		if (strict)
			throw new Error(
				`Cannot read global settings at ${configPath}. Correct the JSON or file permissions, then reload settings.`,
				{ cause: error },
			);
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`[pi-codex-conversion] Failed to read ${scope} config ${configPath}: ${message}`,
		);
		return undefined;
	}
}

export function readCodexConversionConfig(
	configPath: string,
	strict = false,
): CodexConversionConfig {
	return normalizeGlobalConfigDocument(
		readConfigDocument(configPath, "global", strict),
	);
}

export function normalizeGlobalConfigDocument(
	parsed: unknown,
): CodexConversionConfig {
	if (parsed === undefined)
		return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	const migration = migrateCodexConversionConfigIfNeeded(parsed);
	const config = withoutProjectOnlyConfig(
		normalizeCodexConversionConfig(migration.config),
	);
	const voice =
		isRecord(parsed) && isRecord(parsed["voice"]) ? parsed["voice"] : undefined;
	if (typeof voice?.["audioSetupCompleted"] !== "boolean")
		config.voice.audioSetupCompleted = true;
	return config;
}

export function writeCodexConversionConfig(
	config: CodexConversionConfig,
	configPath: string,
	folderScope = false,
): { ok: true } | { ok: false; error: string } {
	try {
		const normalizedConfig = normalizeCodexConversionConfig(
			config,
		) as unknown as Record<string, unknown>;
		const normalized = folderScope
			? withoutDisabledProjectCacheKeepalive(
					withoutGlobalOnlyDocument(normalizedConfig),
				)
			: withoutProjectOnlyDocument(normalizedConfig);
		let document = normalized;
		if (existsSync(configPath)) {
			try {
				const existing = JSON.parse(
					readFileSync(configPath, "utf-8"),
				) as unknown;
				if (isRecord(existing))
					document = mergeConfigDocument(existing, normalized);
			} catch {
				// A valid explicit settings write replaces an unreadable document.
			}
		}
		document = folderScope
			? withoutDisabledProjectCacheKeepalive(
					withoutGlobalOnlyDocument(document),
				)
			: withoutProjectOnlyDocument(document);
		clearAbsentOwnedOptionals(document, normalized, folderScope);
		for (const key of LEGACY_OWNED_CONFIG_KEYS) delete document[key];
		delete document["voiceFeaturesOnly"];
		const compaction = document["compaction"];
		if (isRecord(compaction))
			for (const key of [
				"contextManagement",
				"hybridCompaction",
				"responsesCompaction",
				"portableSummary",
			])
				delete compaction[key];
		const notebook = document["notebook"];
		if (isRecord(notebook)) {
			if (!config.notebook.profile) delete notebook["profile"];
			delete notebook["journals"];
			delete notebook["checkpointCleanup"];
		}
		writeConfigDocumentAtomic(configPath, document);
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`[pi-codex-conversion] Failed to write ${configPath}: ${message}`,
		);
		return { ok: false, error: message };
	}
}

export const CODEX_CONVERSION_CONFIG_BASENAME = "pi-codex-conversion.json";
