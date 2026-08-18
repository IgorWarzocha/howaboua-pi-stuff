import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	isObject,
	normalizeCodexVerbosity,
	normalizeProviderList,
	normalizeV2UserMessageRetention,
	type CodexConversionConfig,
} from "./config.ts";
import { normalizeExecutionMode } from "./execution-mode.ts";

export function migrateCodexConversionConfigIfNeeded(value: unknown): { migrated: boolean; config: unknown } {
	if (!isObject(value)) return { migrated: false, config: value };
	if (normalizeExecutionMode(value["executionMode"]) || isObject(value["scope"]) || isObject(value["tools"]) || isObject(value["ui"]) || isObject(value["compaction"]) || isObject(value["notebook"]) || isObject(value["beta"]) || isObject(value["openai"])) {
		const beta = isObject(value["beta"]) ? value["beta"] : undefined;
		if (beta) {
			const { beta: _beta, ...current } = value;
			const openai = isObject(value["openai"]) ? value["openai"] : {};
			const compaction = isObject(value["compaction"]) ? value["compaction"] : {};
			return {
				migrated: true,
				config: {
					...current,
					executionMode: normalizeExecutionMode(value["executionMode"])
						?? (beta["codeMode"] === true ? "code" : "normal"),
					openai: {
						...openai,
						proxyResponsesLite: typeof openai["proxyResponsesLite"] === "boolean"
							? openai["proxyResponsesLite"]
							: beta["responsesLite"] === true,
					},
					compaction: {
						...compaction,
						v2UserMessageRetention:
							normalizeV2UserMessageRetention(compaction["v2UserMessageRetention"])
								?? normalizeV2UserMessageRetention(beta["v2UserMessageRetention"])
								?? DEFAULT_CODEX_CONVERSION_CONFIG.compaction.v2UserMessageRetention,
					},
				},
			};
		}
		return { migrated: false, config: value };
	}
	const adapterProviderCodexToolsDisabled = value["adapterProviderCodexTools"] === false;

	const config: CodexConversionConfig = {
		...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
	scope: {
			allProviders: value["useOnAllModels"] === true ? "on" : value["useOnAllModels"] === false ? "off" : DEFAULT_CODEX_CONVERSION_CONFIG.scope["allProviders"],
			additionalProviders: value["useAdapterProviders"] === true ? normalizeProviderList(value["adapterProviders"]) : [],
		},
		tools: {
			customRustBinariesDir: DEFAULT_CODEX_CONVERSION_CONFIG.tools["customRustBinariesDir"],
			webRun: adapterProviderCodexToolsDisabled ? false : typeof value["webSearch"] === "boolean" ? value["webSearch"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRun"],
			imageGeneration: adapterProviderCodexToolsDisabled ? false : typeof value["imageGeneration"] === "boolean" ? value["imageGeneration"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGeneration"],
			viewImageFallback: DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageFallback"],
			applyPatchOnly: typeof value["applyPatchOnly"] === "boolean" ? value["applyPatchOnly"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["applyPatchOnly"],
			viewImageOnly: DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageOnly"],
			webRunOnly: DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRunOnly"],
			imageGenerationOnly: DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGenerationOnly"],
		},
		ui: {
			statusLine: typeof value["statusLine"] === "boolean" ? value["statusLine"] : DEFAULT_CODEX_CONVERSION_CONFIG.ui["statusLine"],
			toolRenaming: DEFAULT_CODEX_CONVERSION_CONFIG.ui["toolRenaming"],
			compactTools: DEFAULT_CODEX_CONVERSION_CONFIG.ui["compactTools"],
			codeModeDetails: DEFAULT_CODEX_CONVERSION_CONFIG.ui["codeModeDetails"],
			backgroundShellWidget: typeof value["backgroundShellWidget"] === "boolean" ? value["backgroundShellWidget"] : DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellWidget"],
			backgroundShellToggleShortcut: stringValue(value["backgroundShellToggleShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellToggleShortcut"]),
			backgroundShellPrevShortcut: stringValue(value["backgroundShellPrevShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellPrevShortcut"]),
			backgroundShellNextShortcut: stringValue(value["backgroundShellNextShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellNextShortcut"]),
			backgroundShellCloseShortcut: stringValue(value["backgroundShellCloseShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellCloseShortcut"]),
		},
		compaction: {
			responsesCompaction: typeof value["responsesCompaction"] === "boolean" ? value["responsesCompaction"] : DEFAULT_CODEX_CONVERSION_CONFIG.compaction["responsesCompaction"],
			v2UserMessageRetention: DEFAULT_CODEX_CONVERSION_CONFIG.compaction.v2UserMessageRetention,
		},
		openai: {
			fast: typeof value["fast"] === "boolean" ? value["fast"] : DEFAULT_CODEX_CONVERSION_CONFIG.openai["fast"],
			verbosity: normalizeCodexVerbosity(value["verbosity"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
			cacheKeepalive: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheKeepalive,
			proxyResponsesLite: DEFAULT_CODEX_CONVERSION_CONFIG.openai.proxyResponsesLite,
			forceCachedWebSockets: typeof value["forceCachedWebSockets"] === "boolean" ? value["forceCachedWebSockets"] : DEFAULT_CODEX_CONVERSION_CONFIG.openai["forceCachedWebSockets"],
			cacheDiagnostics: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheDiagnostics,
			harnessIdentifierHeader: DEFAULT_CODEX_CONVERSION_CONFIG.openai["harnessIdentifierHeader"],
			webSearchModel: DEFAULT_CODEX_CONVERSION_CONFIG.openai["webSearchModel"],
		},
	};
	return { migrated: true, config };
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
