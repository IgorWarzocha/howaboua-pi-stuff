import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	isObject,
	normalizeCodexVerbosity,
	normalizeProviderList,
	normalizeV2UserMessageRetention,
	type CodexConversionConfig,
} from "./config.ts";
import { normalizeExecutionMode } from "./execution-mode.ts";
import {
	isRecord,
	needsConfigUpgrade,
	removeLegacyBetaFields,
} from "./config-document.ts";
import {
	normalizeToolDetailsMode,
	resolveLegacyToolDetails,
} from "./config-normalizers.ts";

export type CompactionMigrationInheritance =
	CodexConversionConfig["compaction"] & {
		contextManagement?: unknown;
		hybridCompaction?: unknown;
		continuity?: unknown;
	};

const FLAT_KEYS = [
	"useOnAllModels",
	"useAdapterProviders",
	"adapterProviders",
	"statusLine",
	"backgroundShellWidget",
	"backgroundShellToggleShortcut",
	"backgroundShellPrevShortcut",
	"backgroundShellNextShortcut",
	"backgroundShellCloseShortcut",
	"responsesCompaction",
	"fast",
	"verbosity",
] as const;

export function migrateCodexConversionConfig(
	value: unknown,
	inheritedCompaction: CompactionMigrationInheritance = DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
	inheritedUi?: Record<string, unknown>,
): unknown {
	if (!isRecord(value) || !needsConfigUpgrade(value)) return value;
	if (
		"voiceFeaturesOnly" in value ||
		normalizeExecutionMode(value["executionMode"]) ||
		isObject(value["scope"]) ||
		isObject(value["tools"]) ||
		isObject(value["ui"]) ||
		isObject(value["compaction"]) ||
		isObject(value["notebook"]) ||
		isObject(value["beta"]) ||
		isObject(value["openai"])
	) {
		const previous = isObject(value["compaction"])
			? value["compaction"]
			: undefined;
		const compaction = previous
			? migrateCompactionOptions(previous, inheritedCompaction)
			: undefined;
		const { voiceFeaturesOnly: _voiceFeaturesOnly, ...withoutVoiceOnly } =
			value;
		const document = "voiceFeaturesOnly" in value ? withoutVoiceOnly : value;
		const ui = isObject(value["ui"]) ? value["ui"] : undefined;
		const display = ui ? migrateToolDetails(ui, inheritedUi) : undefined;
		const current =
			compaction !== previous || display !== ui
				? {
						...document,
						...(compaction !== previous ? { compaction } : {}),
						...(display !== ui ? { ui: display } : {}),
					}
				: document;
		const beta = isObject(value["beta"]) ? value["beta"] : undefined;
		if (beta) {
			const openai = isObject(value["openai"]) ? value["openai"] : {};
			const mode =
				value["executionMode"] === "notebook"
					? "notebook"
					: normalizeExecutionMode(value["executionMode"]);
			const retention = normalizeV2UserMessageRetention(
				beta["v2UserMessageRetention"],
			);
			const migrated = {
				...current,
				...(mode
					? { executionMode: mode }
					: typeof beta["codeMode"] === "boolean"
						? { executionMode: beta["codeMode"] ? "code" : "normal" }
						: {}),
				...(typeof openai["proxyResponsesLite"] !== "boolean" &&
				typeof beta["responsesLite"] === "boolean"
					? { openai: { ...openai, proxyResponsesLite: beta["responsesLite"] } }
					: {}),
				...(retention && compaction?.["v2UserMessageRetention"] === undefined
					? { compaction: { ...compaction, v2UserMessageRetention: retention } }
					: {}),
			};
			removeLegacyBetaFields(migrated);
			return migrated;
		}
		return current;
	}
	if (!FLAT_KEYS.some((key) => key in value)) return value;
	const document = { ...value };
	for (const key of FLAT_KEYS) delete document[key];
	const scope: Record<string, unknown> = {};
	if (typeof value["useOnAllModels"] === "boolean")
		scope["allProviders"] = value["useOnAllModels"] ? "on" : "off";
	if (typeof value["useAdapterProviders"] === "boolean")
		scope["additionalProviders"] = value["useAdapterProviders"]
			? normalizeProviderList(value["adapterProviders"])
			: [];
	const ui: Record<string, unknown> = {};
	for (const key of ["statusLine", "backgroundShellWidget"])
		if (typeof value[key] === "boolean") ui[key] = value[key];
	for (const key of FLAT_KEYS)
		if (
			key.endsWith("Shortcut") &&
			typeof value[key] === "string" &&
			value[key].trim()
		)
			ui[key] = value[key].trim();
	const openai: Record<string, unknown> = {};
	if ("fast" in value) openai["fast"] = value["fast"];
	const verbosity = normalizeCodexVerbosity(value["verbosity"]);
	if (verbosity) openai["verbosity"] = verbosity;
	if (Object.keys(scope).length) document["scope"] = scope;
	if (Object.keys(ui).length) document["ui"] = ui;
	if (Object.keys(openai).length) document["openai"] = openai;
	if (typeof value["responsesCompaction"] === "boolean")
		document["compaction"] = {
			method: value["responsesCompaction"] ? "v2" : "pi",
		};
	return document;
}

function migrateToolDetails(
	ui: Record<string, unknown>,
	inherited?: Record<string, unknown>,
): Record<string, unknown> {
	if (!("compactTools" in ui || "codeModeDetails" in ui)) return ui;
	// Translate the old axes only after resolving each scope's explicit overrides.
	const inheritedMode = normalizeToolDetailsMode(inherited?.["toolDetails"]);
	const inheritedLegacyCompact = inherited?.["compactTools"];
	const inheritedLegacyDetails = inherited?.["codeModeDetails"];
	const useLegacy =
		!inheritedMode ||
		((inheritedLegacyCompact !== undefined ||
			inheritedLegacyDetails !== undefined) &&
			resolveLegacyToolDetails(
				inheritedLegacyCompact,
				inheritedLegacyDetails,
			) === inheritedMode);
	const {
		compactTools = useLegacy
			? inheritedLegacyCompact
			: inheritedMode === "minimal"
				? "minimal"
				: "off",
		codeModeDetails = useLegacy
			? inheritedLegacyDetails
			: inheritedMode === "preview",
		...rest
	} = ui;
	if (normalizeToolDetailsMode(rest["toolDetails"])) return rest;
	return {
		...rest,
		toolDetails: resolveLegacyToolDetails(compactTools, codeModeDetails),
	};
}

function migrateCompactionOptions(
	value: Record<string, unknown>,
	inherited: CompactionMigrationInheritance,
): Record<string, unknown> {
	if (
		![
			"contextManagement",
			"hybridCompaction",
			"responsesCompaction",
			"portableSummary",
		].some((key) => key in value)
	)
		return value;
	const inheritedNotes =
		inherited.continuity !== undefined
			? inherited.continuity === "notes" ||
				inherited.continuity === "notes-and-compaction"
			: inherited.contextManagement === "local" ||
				inherited.contextManagement === "tree" ||
				inherited.contextManagement === "remote";
	const mode = value["contextManagement"];
	const notes =
		mode === "off"
			? false
			: mode === "local" || mode === "tree" || mode === "remote"
				? true
				: inheritedNotes;
	const hybrid =
		typeof value["hybridCompaction"] === "boolean"
			? value["hybridCompaction"]
			: inherited.continuity !== undefined
				? inherited.continuity === "notes-and-compaction"
				: inherited.hybridCompaction === true;
	const { responsesCompaction, portableSummary, ...rest } = value;
	const native =
		typeof responsesCompaction === "boolean"
			? responsesCompaction
			: !inheritedNotes && inherited.method !== "pi";
	const portable =
		typeof portableSummary === "boolean"
			? portableSummary
			: inherited.method === "both";
	const overridesMethod = notes
		? typeof value["hybridCompaction"] === "boolean" ||
			(hybrid && typeof portableSummary === "boolean")
		: typeof responsesCompaction === "boolean" ||
			typeof portableSummary === "boolean";
	// Keep continuity fields for their owner; explicit methods override legacy translation.
	return {
		...(overridesMethod
			? {
					method: (notes ? hybrid : native) ? (portable ? "both" : "v2") : "pi",
				}
			: {}),
		...rest,
	};
}
