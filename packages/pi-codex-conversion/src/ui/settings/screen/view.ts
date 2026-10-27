import { CONFIG_DIR_NAME, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../../../adapter/activation/config.ts";
import type { CodexConversionConfigScope } from "../../../adapter/activation/config-store.ts";
import type { CodexLanVoiceServerStatus } from "../../../voice/lan/controller.ts";
import { formatVoiceShortcut } from "../../../voice/setup.ts";
import { getCodexVoiceSystemPromptChangelogPath, getCodexVoiceSystemPromptPath, REALTIME_SYSTEM_PROMPT_BASENAME } from "../../../voice/system-prompt.ts";
import { renderAboutTab } from "../about-tab.ts";
import { SETTINGS_TABS, type SettingsTab } from "../tabs.ts";
import type { createUsageTab } from "../usage-tab.ts";
import type { CodexSettingsScreenOptions } from "../screen.ts";
import type { SettingsConfiguration } from "./configuration.ts";

export function renderSettingsScreen(
	width: number,
	theme: Theme,
	options: CodexSettingsScreenOptions,
	settings: SettingsConfiguration,
	usageTab: ReturnType<typeof createUsageTab>,
): string[] {
	const { activeTab, draft, contextWindowPickerOpen, retentionPickerOpen, list: settingsList } = settings;
	const hasSettingsList = activeTab !== "usage" && activeTab !== "about";
	let settingsLines = hasSettingsList ? settingsList.render(width) : [];
	if (hasSettingsList)
		settingsLines = withConfigScopeDetails(
			settingsLines,
			theme,
			options.configScope.current(),
		);
	if (activeTab === "context" && !contextWindowPickerOpen)
		settingsLines = withContextPortabilityWarning(settingsLines, theme, width);
	if (activeTab === "tools" && !retentionPickerOpen)
		settingsLines = withSettingsDetails(
			settingsLines,
			formatToolsDetails(theme, options.configScope.path()),
		);
	if (activeTab === "voice")
		settingsLines = withSettingsDetails(
			settingsLines,
			formatVoiceDetails(theme, draft, options.configScope.path()),
		);
	return [
		rule(width, theme, "accent"),
		formatTabs(activeTab, theme),
		rule(width, theme, "borderMuted"),
		...(activeTab === "usage" ? usageTab.render(theme, width) : []),
		...(activeTab === "about" ? renderAboutTab(theme) : []),
		...(activeTab === "voice"
			? formatVoiceStatus(theme, options.lanVoiceServer?.status())
			: []),
		"",
		...(hasSettingsList
			? contextWindowPickerOpen ? settingsLines : withSettingsFooter(settingsLines, theme)
			: [theme.fg("dim", formatFooter(activeTab))]),
		rule(width, theme, "accent"),
	].map((line) => truncateToWidth(line, width, ""));
}

function rule(
	width: number,
	theme: Theme,
	color: "accent" | "borderMuted",
): string {
	return theme.fg(color, "─".repeat(Math.max(0, width)));
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	return `  ${SETTINGS_TABS.map(({ id, label }) => (id === activeTab ? theme.bold(label) : theme.fg("dim", label))).join(`  ${theme.fg("dim", "/")}  `)}`;
}

function formatVoiceStatus(
	theme: Theme,
	lanVoice?: CodexLanVoiceServerStatus,
): string[] {
	return [
		...(lanVoice?.running
			? [
					theme.fg("accent", "  LAN voice is running"),
					...lanVoice.urls.map((url) => theme.fg("dim", `  ${url}`)),
					theme.fg("dim", "  First visit: accept the local HTTPS certificate"),
				]
			: [
					theme.fg(
						"dim",
						"  LAN voice serves this session only and stops when the session changes",
					),
				]),
	];
}

function formatVoiceDetails(
	theme: Theme,
	config: CodexConversionConfig,
	configPath: string,
): string[] {
	return [
		theme.fg(
			"dim",
			`  Audio input: ${config.voice.inputDevice ?? "system default"}`,
		),
		theme.fg(
			"dim",
			`  Audio output: ${config.voice.outputDevice ?? "system default"}`,
		),
		theme.fg(
			"dim",
			`  Realtime voice: ${formatVoiceShortcut(config.voice.realtimeShortcut)}`,
		),
		theme.fg(
			"dim",
			`  Mute microphone: ${formatVoiceShortcut(config.voice.muteShortcut)}`,
		),
		theme.fg(
			"dim",
			`  Dictation: ${formatVoiceShortcut(config.voice.dictationShortcut)}`,
		),
		theme.fg(
			"dim",
			`  LAN server: ${formatVoiceShortcut(config.voice.serverShortcut)}`,
		),
		theme.fg(
			"dim",
			`  Change keybinds: ${configPath} (/reload to apply)`,
		),
		theme.fg(
			"dim",
			"  Voice context refresh uses the selected summarisation model",
		),
		"",
		theme.fg(
			"dim",
			`  Realtime system prompt: ${getCodexVoiceSystemPromptPath()}`,
		),
		theme.fg(
			"dim",
			`  Folder-level: create ${CONFIG_DIR_NAME}/${REALTIME_SYSTEM_PROMPT_BASENAME} (appends to global)`,
		),
		theme.fg("dim", "  Realtime system prompt changelog:"),
		theme.fg("dim", `  ${getCodexVoiceSystemPromptChangelogPath()}`),
	];
}

function formatFooter(activeTab: SettingsTab): string {
	if (activeTab === "usage")
		return "  Tab/Shift+Tab sections · R refresh · Ctrl+R use reset · Esc close";
	if (activeTab === "about")
		return "  Tab/Shift+Tab to switch sections · G/C/D/I to open links · Esc to close";
	return "  Tab/Shift+Tab to switch sections · Esc to close";
}

function withSettingsFooter(lines: string[], theme: Theme): string[] {
	const next = [...lines];
	for (let index = next.length - 1; index >= 0; index -= 1) {
		if (next[index]?.includes("Enter/Space")) {
			next[index] = theme.fg(
				"dim",
				"  Enter/Space to change · Esc to close · Tab/Shift+Tab to switch sections",
			);
			break;
		}
	}
	return next;
}

function withConfigScopeDetails(
	lines: string[],
	theme: Theme,
	scope: CodexConversionConfigScope,
): string[] {
	const next = [...lines];
	const scopeIndex = next.findIndex((line) => line.includes("Editing"));
	if (scopeIndex < 0) return next;
	const detail = scope === "folder"
		? "Changes here update this project."
		: "Changes here update global settings.";
	next.splice(scopeIndex + 1, 0, theme.fg("dim", "  " + detail));
	return next;
}

function withContextPortabilityWarning(lines: string[], theme: Theme, width: number): string[] {
	const wrap = (text: string) => wrapTextWithAnsi(text, Math.max(1, width - 2)).map((line) => "  " + line);
	return [
		...wrap("Switching providers?").map((line) => theme.fg("warning", theme.bold(line))),
		...[
			"Use Pi summary or Both for readable checkpoints when switching providers.",
			"V2 checkpoints are encrypted for OpenAI; other providers cannot use them.",
			"Convert existing V2-only history first: select Pi summary and run /compact on the original provider.",
		].flatMap(wrap),
		"",
		...lines,
	];
}

function formatToolsDetails(theme: Theme, configPath: string): string[] {
	return [
		theme.fg("dim", "  Custom native helper overrides:"),
		theme.fg("dim", "  " + configPath),
	];
}

function withSettingsDetails(lines: string[], details: string[]): string[] {
	const next = [...lines];
	const footerIndex = next.findIndex((line) => line.includes("Enter/Space"));
	next.splice(footerIndex < 0 ? next.length : footerIndex, 0, ...details, "");
	return next;
}
