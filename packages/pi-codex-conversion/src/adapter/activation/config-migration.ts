import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	isObject,
	normalizeCodexVerbosity,
	normalizeCompactionModel,
	normalizeCompactionReasoning,
	normalizeProviderList,
	type CodexConversionConfig,
} from "./config.ts";

export function migrateCodexConversionConfigIfNeeded(value: unknown): { migrated: boolean; config: unknown } {
	if (!isObject(value)) return { migrated: false, config: value };
	if (isObject(value["scope"]) || isObject(value["tools"]) || isObject(value["ui"]) || isObject(value["openai"])) {
		return { migrated: false, config: value };
	}
	const adapterProviderCodexToolsDisabled = value["adapterProviderCodexTools"] === false;

	const config: CodexConversionConfig = {
		...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
		scope: {
			allProviders: typeof value["useOnAllModels"] === "boolean" ? value["useOnAllModels"] : DEFAULT_CODEX_CONVERSION_CONFIG.scope["allProviders"],
			additionalProviders: value["useAdapterProviders"] === true ? normalizeProviderList(value["adapterProviders"]) : [],
		},
		tools: {
			webRun: adapterProviderCodexToolsDisabled ? false : typeof value["webSearch"] === "boolean" ? value["webSearch"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRun"],
			imageGeneration: adapterProviderCodexToolsDisabled ? false : typeof value["imageGeneration"] === "boolean" ? value["imageGeneration"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGeneration"],
			applyPatchOnly: typeof value["applyPatchOnly"] === "boolean" ? value["applyPatchOnly"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["applyPatchOnly"],
		},
		ui: {
			statusLine: typeof value["statusLine"] === "boolean" ? value["statusLine"] : DEFAULT_CODEX_CONVERSION_CONFIG.ui["statusLine"],
			toolRendering: DEFAULT_CODEX_CONVERSION_CONFIG.ui["toolRendering"],
			backgroundShellWidget: typeof value["backgroundShellWidget"] === "boolean" ? value["backgroundShellWidget"] : DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellWidget"],
			backgroundShellToggleShortcut: stringValue(value["backgroundShellToggleShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellToggleShortcut"]),
			backgroundShellPrevShortcut: stringValue(value["backgroundShellPrevShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellPrevShortcut"]),
			backgroundShellNextShortcut: stringValue(value["backgroundShellNextShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellNextShortcut"]),
			backgroundShellCloseShortcut: stringValue(value["backgroundShellCloseShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellCloseShortcut"]),
		},
		compaction: {
			responsesCompaction: typeof value["responsesCompaction"] === "boolean" ? value["responsesCompaction"] : DEFAULT_CODEX_CONVERSION_CONFIG.compaction["responsesCompaction"],
		},
		openai: {
			fast: typeof value["fast"] === "boolean" ? value["fast"] : DEFAULT_CODEX_CONVERSION_CONFIG.openai["fast"],
			verbosity: normalizeCodexVerbosity(value["verbosity"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
			forceCachedWebSockets: typeof value["forceCachedWebSockets"] === "boolean" ? value["forceCachedWebSockets"] : DEFAULT_CODEX_CONVERSION_CONFIG.openai["forceCachedWebSockets"],
			webSearchModel: DEFAULT_CODEX_CONVERSION_CONFIG.openai["webSearchModel"],
			compactionModel: normalizeCompactionModel(value["compactionModel"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["compactionModel"],
			compactionReasoning: normalizeCompactionReasoning(value["compactionReasoning"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["compactionReasoning"],
		},
	};
	return { migrated: true, config };
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
