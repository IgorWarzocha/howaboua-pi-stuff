import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	isObject,
	normalizeCodexVerbosity,
	normalizeContextManagementMode,
	normalizeProviderList,
	normalizeV2UserMessageRetention,
	type CodexConversionConfig,
} from "./config.ts";
import { normalizeExecutionMode } from "./execution-mode.ts";

export function migrateCodexConversionConfigIfNeeded(
	value: unknown,
	inheritedCompaction = DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
): { migrated: boolean; config: unknown } {
	if (!isObject(value)) return { migrated: false, config: value };
	if (normalizeExecutionMode(value["executionMode"]) || isObject(value["scope"]) || isObject(value["tools"]) || isObject(value["ui"]) || isObject(value["compaction"]) || isObject(value["notebook"]) || isObject(value["beta"]) || isObject(value["openai"])) {
		const previous = isObject(value["compaction"]) ? value["compaction"] : undefined;
		const compaction = previous ? migrateCompactionOptions(previous, inheritedCompaction) : undefined;
		const current = compaction !== previous ? { ...value, compaction } : value;
		const beta = isObject(value["beta"]) ? value["beta"] : undefined;
		if (beta) {
			const { beta: _beta, ...withoutBeta } = current;
			const openai = isObject(value["openai"]) ? value["openai"] : {};
			return {
				migrated: true,
				config: {
					...withoutBeta,
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
							normalizeV2UserMessageRetention(compaction?.["v2UserMessageRetention"])
								?? normalizeV2UserMessageRetention(beta["v2UserMessageRetention"])
								?? DEFAULT_CODEX_CONVERSION_CONFIG.compaction.v2UserMessageRetention,
					},
				},
			};
		}
		return { migrated: current !== value, config: current };
	}
	const config: CodexConversionConfig = {
		...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
	scope: {
			allProviders: value["useOnAllModels"] === true ? "on" : value["useOnAllModels"] === false ? "off" : DEFAULT_CODEX_CONVERSION_CONFIG.scope["allProviders"],
			additionalProviders: value["useAdapterProviders"] === true ? normalizeProviderList(value["adapterProviders"]) : [],
		},
		tools: {
			autoReasoning: DEFAULT_CODEX_CONVERSION_CONFIG.tools.autoReasoning,
			customRustBinariesDir: DEFAULT_CODEX_CONVERSION_CONFIG.tools["customRustBinariesDir"],
			viewImageFallback: DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageFallback"],
			applyPatchOnly: typeof value["applyPatchOnly"] === "boolean" ? value["applyPatchOnly"] : DEFAULT_CODEX_CONVERSION_CONFIG.tools["applyPatchOnly"],
			viewImageOnly: DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageOnly"],
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
			...DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
			method: value["responsesCompaction"] === true ? "v2" : "pi",
		},
		openai: {
			fast: typeof value["fast"] === "boolean" ? value["fast"] : DEFAULT_CODEX_CONVERSION_CONFIG.openai["fast"],
			verbosity: normalizeCodexVerbosity(value["verbosity"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
			lunaCacheKeepaliveMinutes: DEFAULT_CODEX_CONVERSION_CONFIG.openai.lunaCacheKeepaliveMinutes,
			cacheKeepalive: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheKeepalive,
			proxyResponsesLite: DEFAULT_CODEX_CONVERSION_CONFIG.openai.proxyResponsesLite,
			forceCachedWebSockets: typeof value["forceCachedWebSockets"] === "boolean" ? value["forceCachedWebSockets"] : DEFAULT_CODEX_CONVERSION_CONFIG.openai["forceCachedWebSockets"],
			cacheDiagnostics: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheDiagnostics,
			harnessIdentifierHeader: DEFAULT_CODEX_CONVERSION_CONFIG.openai["harnessIdentifierHeader"],
		},
	};
	return { migrated: true, config };
}

function migrateCompactionOptions(
	value: Record<string, unknown>,
	inherited: CodexConversionConfig["compaction"],
): Record<string, unknown> {
	if (!["contextManagement", "hybridCompaction", "responsesCompaction", "portableSummary"].some((key) => key in value)) return value;
	const modeOverride = normalizeContextManagementMode(value["contextManagement"]);
	const mode = modeOverride
		?? (inherited.continuity === "compaction" ? "off" : inherited.historyStorage);
	const hybrid = typeof value["hybridCompaction"] === "boolean"
		? value["hybridCompaction"] : inherited.continuity === "notes-and-compaction";
	const native = typeof value["responsesCompaction"] === "boolean"
		? value["responsesCompaction"] : inherited.continuity === "compaction" && inherited.method !== "pi";
	const portable = typeof value["portableSummary"] === "boolean"
		? value["portableSummary"] : inherited.method === "both";
	const { contextManagement: _mode, hybridCompaction: _hybrid, responsesCompaction: _native, portableSummary: _portable, ...rest } = value;
	const overridesHybrid = typeof value["hybridCompaction"] === "boolean";
	const overridesMethod = mode !== "off" ? overridesHybrid
		: typeof value["responsesCompaction"] === "boolean" || typeof value["portableSummary"] === "boolean";
	return {
		...(modeOverride !== undefined || (mode !== "off" && overridesHybrid)
			? { continuity: mode === "off" ? "compaction" : hybrid ? "notes-and-compaction" : "notes" } : {}),
		...(modeOverride !== undefined && modeOverride !== "off" ? { historyStorage: modeOverride } : {}),
		...(overridesMethod ? { method: mode !== "off" ? hybrid ? "v2" : "pi" : native ? portable ? "both" : "v2" : "pi" } : {}),
		// Partial project documents override only named axes; explicit new fields win.
		...rest,
	};
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
