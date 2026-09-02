import {
	type CodexConversionConfig,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	MAX_NOTEBOOK_HEAP_MIB,
	MIN_NOTEBOOK_HEAP_MIB,
} from "./config-contract.ts";
import {
	isObject,
	normalizeAllProvidersMode,
	normalizeCacheDiagnosticsMode,
	normalizeCodexVerbosity,
	normalizeCustomRustBinariesDir,
	normalizeDictationShortcutMode,
	normalizeLunaCacheKeepaliveMinutes,
	normalizeProviderList,
	normalizeRealtimeV3Voice,
	normalizeV2UserMessageRetention,
	normalizeVoiceContextReasoning,
} from "./config-normalizers.ts";
import {
	normalizeBoolean,
	normalizeIntegerInRange,
	normalizeNotebookProfile,
	normalizeOptionalString,
	normalizeString,
	normalizeVoiceContextModel,
} from "./config-values.ts";
import { normalizeExecutionMode } from "./execution-mode.ts";

export function normalizeCodexConversionConfig(
	value: unknown,
): CodexConversionConfig {
	if (!isObject(value)) return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	const prompt = isObject(value["prompt"]) ? value["prompt"] : {};
	const scope = isObject(value["scope"]) ? value["scope"] : {};
	const tools = isObject(value["tools"]) ? value["tools"] : {};
	const ui = isObject(value["ui"]) ? value["ui"] : {};
	const compaction = isObject(value["compaction"]) ? value["compaction"] : {};
	const notebook = isObject(value["notebook"]) ? value["notebook"] : {};
	const voice = isObject(value["voice"]) ? value["voice"] : {};
	const openai = isObject(value["openai"]) ? value["openai"] : {};
	const inputDevice = normalizeOptionalString(voice["inputDevice"]);
	const outputDevice = normalizeOptionalString(voice["outputDevice"]);
	const contextModel = normalizeVoiceContextModel(voice["contextModel"]);
	const notebookProfile = normalizeNotebookProfile(notebook["profile"]);
	const executionMode =
		normalizeExecutionMode(value["executionMode"]) ??
		DEFAULT_CODEX_CONVERSION_CONFIG.executionMode;
	const responsesCompaction = normalizeBoolean(
		compaction["responsesCompaction"],
		DEFAULT_CODEX_CONVERSION_CONFIG.compaction.responsesCompaction,
	);
	return {
		executionMode,
		voiceFeaturesOnly: normalizeBoolean(
			value["voiceFeaturesOnly"],
			DEFAULT_CODEX_CONVERSION_CONFIG.voiceFeaturesOnly,
		),
		prompt: {
			heavySystemPromptOverwrite: normalizeBoolean(
				prompt["heavySystemPromptOverwrite"],
				DEFAULT_CODEX_CONVERSION_CONFIG.prompt.heavySystemPromptOverwrite,
			),
		},
		scope: {
			allProviders:
				normalizeAllProvidersMode(scope["allProviders"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.scope["allProviders"],
			additionalProviders: normalizeProviderList(scope["additionalProviders"]),
		},
		tools: {
			customRustBinariesDir: normalizeCustomRustBinariesDir(
				tools["customRustBinariesDir"],
			),
			viewImageFallback: normalizeBoolean(
				tools["viewImageFallback"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageFallback"],
			),
			applyPatchOnly: normalizeBoolean(
				tools["applyPatchOnly"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["applyPatchOnly"],
			),
			viewImageOnly: normalizeBoolean(
				tools["viewImageOnly"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageOnly"],
			),
		},
		ui: {
			statusLine: normalizeBoolean(
				ui["statusLine"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["statusLine"],
			),
			toolRenaming: normalizeBoolean(
				ui["toolRenaming"],
				normalizeBoolean(
					ui["toolRendering"],
					DEFAULT_CODEX_CONVERSION_CONFIG.ui["toolRenaming"],
				),
			),
			compactTools: normalizeBoolean(
				ui["compactTools"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["compactTools"],
			),
			codeModeDetails: normalizeBoolean(
				ui["codeModeDetails"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["codeModeDetails"],
			),
			backgroundShellWidget: normalizeBoolean(
				ui["backgroundShellWidget"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellWidget"],
			),
			backgroundShellToggleShortcut: normalizeString(
				ui["backgroundShellToggleShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellToggleShortcut"],
			),
			backgroundShellPrevShortcut: normalizeString(
				ui["backgroundShellPrevShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellPrevShortcut"],
			),
			backgroundShellNextShortcut: normalizeString(
				ui["backgroundShellNextShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellNextShortcut"],
			),
			backgroundShellCloseShortcut: normalizeString(
				ui["backgroundShellCloseShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellCloseShortcut"],
			),
		},
		compaction: {
			responsesCompaction,
			portableSummary:
				normalizeBoolean(
					compaction["portableSummary"],
					DEFAULT_CODEX_CONVERSION_CONFIG.compaction["portableSummary"],
				) && responsesCompaction,
			v2UserMessageRetention:
				normalizeV2UserMessageRetention(compaction["v2UserMessageRetention"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.compaction.v2UserMessageRetention,
		},
		notebook: {
			maxHeapMiB: normalizeIntegerInRange(
				notebook["maxHeapMiB"],
				DEFAULT_CODEX_CONVERSION_CONFIG.notebook.maxHeapMiB,
				MIN_NOTEBOOK_HEAP_MIB,
				MAX_NOTEBOOK_HEAP_MIB,
			),
			...(notebookProfile ? { profile: notebookProfile } : {}),
		},
		voice: {
			v3Voice:
				normalizeRealtimeV3Voice(voice["v3Voice"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.v3Voice,
			autoResumeRealtime: normalizeBoolean(
				voice["autoResumeRealtime"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.autoResumeRealtime,
			),
			refreshRealtimeAfterCompaction: normalizeBoolean(
				voice["refreshRealtimeAfterCompaction"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.refreshRealtimeAfterCompaction,
			) && contextModel !== undefined,
			audioSetupCompleted: normalizeBoolean(
				voice["audioSetupCompleted"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.audioSetupCompleted,
			),
			delegationAcknowledgements: normalizeBoolean(
				voice["delegationAcknowledgements"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.delegationAcknowledgements,
			),
			forwardReasoningSummaries: normalizeBoolean(
				voice["forwardReasoningSummaries"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.forwardReasoningSummaries,
			),
			dictationShortcut: normalizeString(
				voice["dictationShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.dictationShortcut,
			),
			realtimeShortcut: normalizeString(
				voice["realtimeShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.realtimeShortcut,
			),
			muteShortcut: normalizeString(
				voice["muteShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.muteShortcut,
			),
			serverShortcut: normalizeString(
				voice["serverShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.serverShortcut,
			),
			dictationShortcutMode:
				normalizeDictationShortcutMode(voice["dictationShortcutMode"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.dictationShortcutMode,
			...(contextModel ? { contextModel } : {}),
			contextReasoning: normalizeVoiceContextReasoning(
				voice["contextReasoning"],
			),
			...(inputDevice ? { inputDevice } : {}),
			...(outputDevice ? { outputDevice } : {}),
		},
		openai: {
			fast: normalizeBoolean(
				openai["fast"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["fast"],
			),
			verbosity:
				normalizeCodexVerbosity(openai["verbosity"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
			lunaCacheKeepaliveMinutes:
				normalizeLunaCacheKeepaliveMinutes(
					openai["lunaCacheKeepaliveMinutes"],
				) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.lunaCacheKeepaliveMinutes,
			cacheKeepalive: normalizeBoolean(
				openai["cacheKeepalive"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["cacheKeepalive"],
			),
			proxyResponsesLite: normalizeBoolean(
				openai["proxyResponsesLite"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai.proxyResponsesLite,
			),
			forceCachedWebSockets: normalizeBoolean(
				openai["forceCachedWebSockets"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["forceCachedWebSockets"],
			),
			cacheDiagnostics:
				normalizeCacheDiagnosticsMode(openai["cacheDiagnostics"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.openai.cacheDiagnostics,
			harnessIdentifierHeader: normalizeBoolean(
				openai["harnessIdentifierHeader"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["harnessIdentifierHeader"],
			),
		},
	};
}
