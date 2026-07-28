import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Focusable, Input, Spacer, Text, type SettingItem } from "@earendil-works/pi-tui";
import {
	DEFAULT_CODEX_CONVERSION_CONFIG,
	REALTIME_V3_VOICES,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
	WEB_SEARCH_MODELS,
	normalizeCodexVerbosity,
	normalizeProviderList,
	normalizeRealtimeV3Voice,
	normalizeV2UserMessageRetention,
	normalizeWebSearchModel,
	type CodexConversionConfig,
} from "../../adapter/activation/config.ts";
import { getCodexConversionConfigPath } from "../../adapter/activation/config-store.ts";
import { editorCommand } from "./config-editor.ts";
import type { SettingsTab } from "./tabs.ts";

export interface ConfigSetting {
	item: SettingItem;
	update?: ((value: string, config: CodexConversionConfig) => CodexConversionConfig) | undefined;
	action?: "edit-config" | undefined;
}

class TextSettingSubmenu extends Container implements Focusable {
	private input: Input;

	constructor(title: string, description: string, currentValue: string, onSubmit: (value: string) => void, onCancel: () => void, theme: Theme) {
		super();
		this.input = new Input();
		this.input.setValue(currentValue);
		this.input.onSubmit = () => onSubmit(this.input.getValue());
		this.input.onEscape = onCancel;
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", description), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.input);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to save · Esc to cancel"), 0, 0));
	}

	get focused(): boolean { return this.input.focused; }
	set focused(value: boolean) { this.input.focused = value; }
	handleInput(data: string): void { this.input.handleInput(data); }
}

function setting(item: SettingItem, update?: ConfigSetting["update"]): ConfigSetting {
	return { item, ...(update ? { update } : {}) };
}

function toggle(
	id: string,
	label: string,
	current: boolean,
	update: (enabled: boolean, config: CodexConversionConfig) => CodexConversionConfig,
): ConfigSetting {
	return setting(
		{ id, label, currentValue: current ? "on" : "off", values: ["off", "on"] },
		(value, config) => update(value === "on", config),
	);
}

export function buildConfigSettings(tab: SettingsTab, config: CodexConversionConfig, theme: Theme): ConfigSetting[] {
	if (tab === "adapter") {
		return [
			setting(
				{ id: "extensionMode", label: "Extension mode", currentValue: config.voiceFeaturesOnly ? "voice only" : "adapter and voice", values: ["adapter and voice", "voice only"] },
				(value, current) => ({ ...current, voiceFeaturesOnly: value === "voice only" }),
			),
			setting(
				{ id: "allProviders", label: "Provider scope", currentValue: formatAllProvidersMode(config.scope.allProviders), values: ["Codex and configured", "all providers", "extra tools only"] },
				(value, current) => ({ ...current, scope: { ...current.scope, allProviders: parseAllProvidersMode(value) } }),
			),
			setting({
				id: "additionalProviders",
				label: "Additional providers",
				currentValue: config.scope.additionalProviders.join(", "),
				submenu: (currentValue, done) => new TextSettingSubmenu(
					"Additional providers",
					"Comma-separated provider ids that should use the adapter.",
					currentValue,
					(value) => done(normalizeCodexProviderText(value)),
					() => done(),
					theme,
				),
			}, (value, current) => ({ ...current, scope: { ...current.scope, additionalProviders: normalizeProviderList(value.split(",")) } })),
			setting(
				{ id: "heavySystemPromptOverwrite", label: "Heavy system prompt overwrite", currentValue: config.prompt.heavySystemPromptOverwrite ? "on (40% smaller)" : "off", values: ["off", "on (40% smaller)"] },
				(value, current) => ({ ...current, prompt: { ...current.prompt, heavySystemPromptOverwrite: value !== "off" } }),
			),
			{ item: { id: "editConfig", label: "Edit config", currentValue: editorCommand() ? "Opens in default editor (please /reload)" : "Set $EDITOR", values: editorCommand() ? ["Open"] : ["Unavailable"] }, action: "edit-config" },
		];
	}

	if (tab === "tools") {
		return [
			toggle("codeMode", "GPT-5.6 Code Mode", config.beta.codeMode, (enabled, current) => ({ ...current, beta: { ...current.beta, codeMode: enabled } })),
			toggle("viewImageFallback", "Text Image Descriptions", config.tools.viewImageFallback, (enabled, current) => ({ ...current, tools: { ...current.tools, viewImageFallback: enabled } })),
			toggle("webRun", "Web search", config.tools.webRun, (enabled, current) => ({ ...current, tools: { ...current.tools, webRun: enabled } })),
			setting({ id: "webSearchModel", label: "Web search model", currentValue: config.openai.webSearchModel, values: [...WEB_SEARCH_MODELS] }, (value, current) => ({ ...current, openai: { ...current.openai, webSearchModel: normalizeWebSearchModel(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.webSearchModel } })),
			toggle("imageGeneration", "Image generation", config.tools.imageGeneration, (enabled, current) => ({ ...current, tools: { ...current.tools, imageGeneration: enabled } })),
			setting({ id: "activateOnlyHeader", label: theme.fg("dim", "Activate Only"), currentValue: "" }),
			toggle("applyPatchOnly", "apply_patch", config.tools.applyPatchOnly, (enabled, current) => ({ ...current, tools: { ...current.tools, applyPatchOnly: enabled } })),
			toggle("viewImageOnly", "view_image", config.tools.viewImageOnly, (enabled, current) => ({ ...current, tools: { ...current.tools, viewImageOnly: enabled } })),
			toggle("webRunOnly", "web_run", config.tools.webRunOnly, (enabled, current) => ({ ...current, tools: { ...current.tools, webRunOnly: enabled } })),
			toggle("imageGenerationOnly", "imagegen", config.tools.imageGenerationOnly, (enabled, current) => ({ ...current, tools: { ...current.tools, imageGenerationOnly: enabled } })),
			setting({ id: "customRustBinariesHelp", label: theme.fg("dim", "For compatibility with custom Rust binaries, edit:"), currentValue: "" }),
			setting({ id: "customRustBinariesPath", label: theme.fg("dim", getCodexConversionConfigPath()), currentValue: "" }),
		];
	}

	if (tab === "openai") {
		return [
			toggle("fast", "Fast mode", config.openai.fast, (enabled, current) => ({ ...current, openai: { ...current.openai, fast: enabled } })),
			setting({ id: "verbosity", label: "Verbosity", currentValue: config.openai.verbosity, values: ["low", "medium", "high"] }, (value, current) => ({ ...current, openai: { ...current.openai, verbosity: normalizeCodexVerbosity(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.verbosity } })),
			setting({ id: "transportHeader", label: theme.fg("dim", "Transport"), currentValue: "" }),
			toggle("responsesLite", "Proxy Responses Lite", config.beta.responsesLite, (enabled, current) => ({ ...current, beta: { ...current.beta, responsesLite: enabled } })),
			toggle("forceCachedWebSockets", "Cached WebSocket upgrade", config.openai.forceCachedWebSockets, (enabled, current) => ({ ...current, openai: { ...current.openai, forceCachedWebSockets: enabled } })),
			setting(
				{ id: "harnessIdentifierHeader", label: "Harness identifier header", currentValue: config.openai.harnessIdentifierHeader ? "pi-codex-conversion <3" : "off", values: ["off", "pi-codex-conversion <3"] },
				(value, current) => ({ ...current, openai: { ...current.openai, harnessIdentifierHeader: value !== "off" } }),
			),
			setting({ id: "compactionHeader", label: theme.fg("dim", "Compaction"), currentValue: "" }),
			toggle("responsesCompaction", "Responses compaction V2", config.compaction.responsesCompaction, (enabled, current) => ({ ...current, compaction: { ...current.compaction, responsesCompaction: enabled } })),
			setting({ id: "v2UserMessageRetention", label: "Preserved user messages", currentValue: `${config.beta.v2UserMessageRetention ?? 64}k${(config.beta.v2UserMessageRetention ?? 64) === 64 ? " (Codex native)" : ""}`, values: V2_USER_MESSAGE_RETENTION_OPTIONS.map((value) => `${value}k${value === 64 ? " (Codex native)" : ""}`) }, (value, current) => ({ ...current, beta: { ...current.beta, v2UserMessageRetention: normalizeV2UserMessageRetention(Number.parseInt(value, 10)) ?? 64 } })),
		];
	}

	if (tab === "display") {
		return [
			toggle("statusLine", "Statusline", config.ui.statusLine, (enabled, current) => ({ ...current, ui: { ...current.ui, statusLine: enabled } })),
			toggle("toolRenaming", "Tool naming", config.ui.toolRenaming, (enabled, current) => ({ ...current, ui: { ...current.ui, toolRenaming: enabled } })),
			toggle("compactTools", "Compact tool output", config.ui.compactTools, (enabled, current) => ({ ...current, ui: { ...current.ui, compactTools: enabled } })),
			toggle("codeModeDetails", "Code Mode details", config.ui.codeModeDetails, (enabled, current) => ({ ...current, ui: { ...current.ui, codeModeDetails: enabled } })),
			toggle("backgroundShellWidget", "Background shells widget", config.ui.backgroundShellWidget, (enabled, current) => ({ ...current, ui: { ...current.ui, backgroundShellWidget: enabled } })),
		];
	}

	if (tab === "voice") {
		return [
			setting({ id: "v3Voice", label: "Codex voice", currentValue: formatVoiceName(config.voice.v3Voice), values: REALTIME_V3_VOICES.map(formatVoiceName) }, (value, current) => ({ ...current, voice: { ...current.voice, v3Voice: normalizeRealtimeV3Voice(value.toLowerCase()) ?? current.voice.v3Voice } })),
			setting({ id: "dictationShortcutMode", label: "Dictation key behavior", currentValue: config.voice.dictationShortcutMode === "push" ? "push to dictate" : "toggle", values: ["push to dictate", "toggle"] }, (value, current) => ({ ...current, voice: { ...current.voice, dictationShortcutMode: value === "toggle" ? "toggle" : "push" } })),
		];
	}

	return [];
}

function formatAllProvidersMode(value: CodexConversionConfig["scope"]["allProviders"]): string {
	if (value === "on") return "all providers";
	if (value === "extras") return "extra tools only";
	return "Codex and configured";
}

function parseAllProvidersMode(value: string): CodexConversionConfig["scope"]["allProviders"] {
	if (value === "all providers") return "on";
	if (value === "extra tools only") return "extras";
	return "off";
}

function normalizeCodexProviderText(value: string): string {
	return normalizeProviderList(value.split(",")).join(", ");
}

function formatVoiceName(voice: string): string {
	return `${voice.slice(0, 1).toUpperCase()}${voice.slice(1)}`;
}
