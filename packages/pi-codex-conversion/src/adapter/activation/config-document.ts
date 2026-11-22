import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	arr,
	bool,
	compile,
	int,
	lit,
	nul,
	obj,
	opt,
	str,
	union,
	type Properties,
} from "@earendil-works/pi-schema";
import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	GIPPITY_VOICE_MODELS,
	MAX_NOTEBOOK_HEAP_MIB,
	MIN_NOTEBOOK_HEAP_MIB,
	REALTIME_V3_VOICES,
	VOICE_CONTEXT_REASONING_LEVELS,
	type CodexConversionConfig,
} from "./config.ts";
import { normalizeCodexVerbosity } from "./config-normalizers.ts";

export const OWNED_CONFIG_KEYS = Object.keys(DEFAULT_CODEX_CONVERSION_CONFIG);
export const LEGACY_OWNED_CONFIG_KEYS = ["beta"];
export const SETTINGS_VERSION = 1;

const section = (fields: Properties) => opt(obj(fields, { open: true }));
const values = (...choices: (string | number)[]) =>
	opt(union(choices.map((choice) => lit(choice))));
const flag = opt(bool());
const string = opt(str());
const speed = union([bool(), lit("ultrafast")]);
const fast = opt(
	union([
		speed,
		obj(
			{
				astra: opt(speed),
				sol: opt(speed),
				terra: opt(speed),
				luna: opt(speed),
				other: opt(speed),
			},
			{ open: true },
		),
	]),
);
const shortcuts = {
	backgroundShellToggleShortcut: string,
	backgroundShellPrevShortcut: string,
	backgroundShellNextShortcut: string,
	backgroundShellCloseShortcut: string,
};
const retention = values(16, 32, 64);
const settingsDocument = compile(
	obj(
		{
			settingsVersion: values(0, SETTINGS_VERSION),
			executionMode: values("normal", "code", "ts", "vm", "js", "notebook"),
			useOnAllModels: flag,
			useAdapterProviders: flag,
			adapterProviders: opt(arr(str())),
			statusLine: flag,
			backgroundShellWidget: flag,
			...shortcuts,
			responsesCompaction: flag,
			fast,
			verbosity: string,
			voiceFeaturesOnly: flag,
			applyPatchOnly: flag,
			viewImageOnly: flag,
			beta: section({
				codeMode: flag,
				responsesLite: flag,
				v2UserMessageRetention: retention,
			}),
			scope: section({
				allProviders: opt(
					union([bool(), lit("off"), lit("on"), lit("extras")]),
				),
				additionalProviders: opt(arr(str())),
			}),
			ui: section({
				toolDetails: values("minimal", "compact", "preview"),
				statusLine: flag,
				toolRenaming: flag,
				backgroundShellWidget: flag,
				...shortcuts,
				compactTools: opt(
					union([bool(), lit("off"), lit("on"), lit("minimal")]),
				),
				codeModeDetails: flag,
			}),
			prompt: section({
				heavySystemPromptOverwrite: opt(union([bool(), lit("gpt")])),
				currentTimeReminderMinutes: values(0, 30, 60),
			}),
			tools: section({
				autoReasoning: flag,
				viewImageFallback: flag,
				customRustBinariesDir: string,
				applyPatchOnly: flag,
				viewImageOnly: flag,
			}),
			compaction: section({
				method: values("pi", "v2", "both"),
				v2UserMessageRetention: retention,
				responsesCompaction: flag,
				portableSummary: flag,
				hybridCompaction: flag,
				contextManagement: values("off", "local", "tree", "remote"),
			}),
			notebook: section({
				journals: values("off", "week", "on"),
				checkpointCleanup: values("never", "month", "week"),
				maxHeapMiB: opt(
					int({
						minimum: MIN_NOTEBOOK_HEAP_MIB,
						maximum: MAX_NOTEBOOK_HEAP_MIB,
					}),
				),
				plainCommandOutput: flag,
				profile: string,
			}),
			voice: section({
				model: values(...GIPPITY_VOICE_MODELS),
				apiProvider: string,
				realtimeVoice: string,
				realtimeAlternateVoice: string,
				v3Voice: values(...REALTIME_V3_VOICES),
				v3AlternateVoice: values(...REALTIME_V3_VOICES),
				webSearch: flag,
				audioSetupCompleted: flag,
				autoResumeRealtime: flag,
				refreshRealtimeAfterCompaction: flag,
				delegationAcknowledgements: flag,
				forwardReasoningSummaries: flag,
				dictationShortcut: string,
				realtimeShortcut: string,
				muteShortcut: string,
				serverShortcut: string,
				dictationShortcutMode: values("push", "toggle"),
				contextModel: opt(
					union([
						nul(),
						lit("current"),
						obj({ provider: str(), modelId: str() }, { open: true }),
					]),
				),
				contextReasoning: values(...VOICE_CONTEXT_REASONING_LEVELS),
				taskDelegationModel: string,
				taskDelegationReasoning: values(...VOICE_CONTEXT_REASONING_LEVELS),
				inputDevice: string,
				outputDevice: string,
			}),
			openai: section({
				fast,
				harnessIdentifierHeader: opt(union([bool(), lit("codex")])),
				daybreak: flag,
				verbosity: values("low", "medium", "high"),
				lunaCacheKeepaliveMinutes: values(0, 5, 10, 15),
				lunaCacheKeepaliveIntervalMinutes: values(2.5, 4.5),
				cacheKeepalive: flag,
				cacheKeepaliveIntervalMinutes: values(25, 55),
				proxyResponsesLite: flag,
				cacheDiagnostics: values("off", "status", "status-and-log"),
			}),
		},
		{ open: true },
	),
);

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function needsConfigUpgrade(document: Record<string, unknown>): boolean {
	return (
		document["settingsVersion"] === undefined ||
		document["settingsVersion"] === 0
	);
}

export function assertWritableConfig(document: Record<string, unknown>): void {
	if (
		!needsConfigUpgrade(document) &&
		document["settingsVersion"] !== SETTINGS_VERSION
	)
		throw new Error(
			"This settings version is not supported. Upgrade Pi Codex Conversion before saving it",
		);
}

export function stampConfigDocument(
	document: Record<string, unknown>,
): Record<string, unknown> {
	const prompt = document["prompt"];
	const current = {
		...document,
		...(isRecord(prompt) && prompt["heavySystemPromptOverwrite"] === "gpt"
			? { prompt: { ...prompt, heavySystemPromptOverwrite: true } }
			: {}),
		settingsVersion: SETTINGS_VERSION,
	};
	assertConfigDocument(current);
	return current;
}

export function assertConfigDocument(document: Record<string, unknown>): void {
	if (
		!settingsDocument.check(document) ||
		("verbosity" in document && !normalizeCodexVerbosity(document["verbosity"]))
	)
		throw new Error(
			"The settings contain invalid values. Check the file before saving it",
		);
}

export function removeLegacyBetaFields(
	document: Record<string, unknown>,
): void {
	const beta = document["beta"];
	if (!isRecord(beta)) return;
	const {
		codeMode: _codeMode,
		responsesLite: _responsesLite,
		v2UserMessageRetention: _v2UserMessageRetention,
		...rest
	} = beta;
	if (Object.keys(rest).length > 0) document["beta"] = rest;
	else delete document["beta"];
}

export function mergeConfigDocument(
	existing: Record<string, unknown>,
	owned: Record<string, unknown>,
): Record<string, unknown> {
	const merged = { ...existing };
	for (const [key, value] of Object.entries(owned)) {
		const previous = merged[key];
		merged[key] =
			isRecord(previous) && isRecord(value)
				? mergeConfigDocument(previous, value)
				: value;
	}
	return merged;
}

export function clearAbsentOwnedOptionals(
	document: Record<string, unknown>,
	owned: Record<string, unknown>,
	folderScope: boolean,
): void {
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

export function writeConfigDocumentAtomic(
	configPath: string,
	document: Record<string, unknown>,
): void {
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

export function withoutProjectOnlyConfig(
	config: CodexConversionConfig,
): CodexConversionConfig {
	return {
		...config,
		openai: {
			...config.openai,
			cacheKeepalive: false,
			cacheKeepaliveIntervalMinutes: 25,
		},
	};
}

export function withoutProjectOnlyDocument(
	document: Record<string, unknown>,
): Record<string, unknown> {
	const openai = isRecord(document["openai"])
		? { ...document["openai"] }
		: undefined;
	if (!openai) return document;
	delete openai["cacheKeepalive"];
	delete openai["cacheKeepaliveIntervalMinutes"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

export function withoutGlobalOnlyDocument(
	document: Record<string, unknown>,
): Record<string, unknown> {
	const openai = isRecord(document["openai"])
		? { ...document["openai"] }
		: undefined;
	if (!openai) return document;
	delete openai["lunaCacheKeepaliveMinutes"];
	delete openai["lunaCacheKeepaliveIntervalMinutes"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}

export function withoutDisabledProjectCacheKeepalive(
	document: Record<string, unknown>,
): Record<string, unknown> {
	const openai = isRecord(document["openai"])
		? { ...document["openai"] }
		: undefined;
	if (!openai || openai["cacheKeepalive"] !== false) return document;
	delete openai["cacheKeepalive"];
	const next = { ...document };
	if (Object.keys(openai).length > 0) next["openai"] = openai;
	else delete next["openai"];
	return next;
}
