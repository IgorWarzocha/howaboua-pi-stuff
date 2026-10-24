import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	isObject,
	normalizeCodexVerbosity,
	normalizeProviderList,
	normalizeV2UserMessageRetention,
	type CodexConversionConfig,
} from "./config.ts";
import { normalizeExecutionMode } from "./execution-mode.ts";
import { normalizeFastMode } from "./fast-mode.ts";

export type CompactionMigrationInheritance = CodexConversionConfig["compaction"] & {
	contextManagement?: unknown;
	hybridCompaction?: unknown;
	continuity?: unknown;
};

export function migrateCodexConversionConfigIfNeeded(
	value: unknown,
	inheritedCompaction: CompactionMigrationInheritance = DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
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
			fast: normalizeFastMode(value["fast"]),
			daybreak: DEFAULT_CODEX_CONVERSION_CONFIG.openai.daybreak,
			verbosity: normalizeCodexVerbosity(value["verbosity"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
			lunaCacheKeepaliveMinutes: DEFAULT_CODEX_CONVERSION_CONFIG.openai.lunaCacheKeepaliveMinutes,
			lunaCacheKeepaliveIntervalMinutes: DEFAULT_CODEX_CONVERSION_CONFIG.openai.lunaCacheKeepaliveIntervalMinutes,
			cacheKeepalive: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheKeepalive,
			cacheKeepaliveIntervalMinutes: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheKeepaliveIntervalMinutes,
			proxyResponsesLite: DEFAULT_CODEX_CONVERSION_CONFIG.openai.proxyResponsesLite,
			cacheDiagnostics: DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheDiagnostics,
			harnessIdentifierHeader: DEFAULT_CODEX_CONVERSION_CONFIG.openai["harnessIdentifierHeader"],
		},
	};
	return { migrated: true, config };
}

function migrateCompactionOptions(
	value: Record<string, unknown>,
	inherited: CompactionMigrationInheritance,
): Record<string, unknown> {
	if (!["contextManagement", "hybridCompaction", "responsesCompaction", "portableSummary"].some((key) => key in value)) return value;
	const inheritedNotes = inherited.continuity !== undefined
		? inherited.continuity === "notes" || inherited.continuity === "notes-and-compaction"
		: inherited.contextManagement === "local" || inherited.contextManagement === "tree" || inherited.contextManagement === "remote";
	const mode = value["contextManagement"];
	const notes = mode === "off" ? false : mode === "local" || mode === "tree" || mode === "remote" ? true : inheritedNotes;
	const hybrid = typeof value["hybridCompaction"] === "boolean" ? value["hybridCompaction"]
		: inherited.continuity !== undefined ? inherited.continuity === "notes-and-compaction" : inherited.hybridCompaction === true;
	const { responsesCompaction, portableSummary, ...rest } = value;
	const native = typeof responsesCompaction === "boolean" ? responsesCompaction : !inheritedNotes && inherited.method !== "pi";
	const portable = typeof portableSummary === "boolean" ? portableSummary : inherited.method === "both";
	const overridesMethod = notes
		? typeof value["hybridCompaction"] === "boolean" || (hybrid && typeof portableSummary === "boolean")
		: typeof responsesCompaction === "boolean" || typeof portableSummary === "boolean";
	// Keep continuity fields for their owner; explicit methods override legacy translation.
	return { ...(overridesMethod ? { method: (notes ? hybrid : native) ? portable ? "both" : "v2" : "pi" } : {}), ...rest };
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
