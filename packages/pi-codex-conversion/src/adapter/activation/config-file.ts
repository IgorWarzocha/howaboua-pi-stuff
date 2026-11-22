import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
	assertConfigDocument,
	assertWritableConfig,
	isRecord,
	mergeConfigDocument,
	needsConfigUpgrade,
	removeLegacyBetaFields,
	stampConfigDocument,
	clearAbsentOwnedOptionals,
	writeConfigDocumentAtomic,
	withoutProjectOnlyConfig,
	withoutProjectOnlyDocument,
	withoutGlobalOnlyDocument,
	withoutDisabledProjectCacheKeepalive,
} from "./config-document.ts";
import { migrateCodexConversionConfig } from "./config-migration.ts";
import {
	normalizeAllProvidersMode,
	resolveLegacyToolDetails,
} from "./config-normalizers.ts";
import { normalizeExecutionMode } from "./execution-mode.ts";
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
	upgradePath?: string,
): CodexConversionConfig {
	if (parsed === undefined)
		return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	const current = migrateCodexConversionConfig(parsed);
	if (upgradePath) persistConfigUpgrade(upgradePath, parsed, current, false);
	const config = withoutProjectOnlyConfig(
		normalizeCodexConversionConfig(current),
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
		let existing: unknown;
		if (existsSync(configPath)) {
			try {
				existing = JSON.parse(readFileSync(configPath, "utf-8"));
			} catch {
				// An explicit settings save may replace an unreadable document.
			}
		}
		if (isRecord(existing)) {
			assertWritableConfig(existing);
			document = mergeConfigDocument(existing, normalized);
		}
		document = folderScope
			? withoutDisabledProjectCacheKeepalive(
					withoutGlobalOnlyDocument(document),
				)
			: withoutProjectOnlyDocument(document);
		clearAbsentOwnedOptionals(document, normalized, folderScope);
		if (!config.notebook.profile && isRecord(document["notebook"]))
			delete document["notebook"]["profile"];
		cleanRetiredFields(document, folderScope);
		writeConfigDocumentAtomic(configPath, stampConfigDocument(document));
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`[pi-codex-conversion] Failed to write ${configPath}: ${message}`,
		);
		return { ok: false, error: message };
	}
}

function cleanRetiredFields(
	document: Record<string, unknown>,
	folderScope: boolean,
): void {
	removeLegacyBetaFields(document);
	delete document["voiceFeaturesOnly"];
	delete document["applyPatchOnly"];
	delete document["viewImageOnly"];
	const tools = document["tools"];
	if (isRecord(tools)) {
		delete tools["applyPatchOnly"];
		delete tools["viewImageOnly"];
	}
	const ui = document["ui"];
	// Unmigrated project files can still inherit these global axes. An
	// unrelated settings write must not discard them.
	if (
		isRecord(ui) &&
		(folderScope ||
			resolveLegacyToolDetails(ui["compactTools"], ui["codeModeDetails"]) !==
				ui["toolDetails"])
	) {
		delete ui["compactTools"];
		delete ui["codeModeDetails"];
	}
	const openai = document["openai"];
	if (isRecord(openai)) delete openai["harnessIdentifierHeader"];
	const compaction = document["compaction"];
	if (isRecord(compaction))
		for (const key of ["responsesCompaction", "portableSummary"])
			delete compaction[key];
	const notebook = document["notebook"];
	if (isRecord(notebook)) {
		delete notebook["journals"];
		delete notebook["checkpointCleanup"];
	}
}

export function persistConfigUpgrade(
	path: string,
	original: unknown,
	migrated: unknown,
	folderScope: boolean,
): void {
	if (
		!isRecord(original) ||
		!needsConfigUpgrade(original) ||
		!isRecord(migrated)
	)
		return;
	try {
		// Validate what came from disk before translation or pruning can hide mistakes.
		assertConfigDocument(original);
		// Do not replace symlinks, or overwrite changes made since the read.
		if (
			!lstatSync(path).isFile() ||
			!isDeepStrictEqual(JSON.parse(readFileSync(path, "utf8")), original)
		)
			return;
		const document = structuredClone(migrated);
		if (document["executionMode"] !== "notebook") {
			const mode = normalizeExecutionMode(document["executionMode"]);
			if (mode) document["executionMode"] = mode;
		}
		const scope = document["scope"];
		if (isRecord(scope)) {
			const mode = normalizeAllProvidersMode(scope["allProviders"]);
			if (mode) scope["allProviders"] = mode;
		}
		// Older project files can still inherit the pre-preset global axes.
		const oldUi = original["ui"];
		const ui = document["ui"];
		if (!folderScope && isRecord(oldUi) && isRecord(ui))
			for (const key of ["compactTools", "codeModeDetails"])
				if (key in oldUi) ui[key] = oldUi[key];
		cleanRetiredFields(document, folderScope);
		writeConfigDocumentAtomic(path, stampConfigDocument(document));
	} catch (error) {
		console.warn(
			`[pi-codex-conversion] Could not upgrade settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export const CODEX_CONVERSION_CONFIG_BASENAME = "pi-codex-conversion.json";
