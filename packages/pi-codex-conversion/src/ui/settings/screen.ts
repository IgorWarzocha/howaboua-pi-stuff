import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import {
	getCodexConversionConfigPath,
	readCodexConversionConfig,
} from "../../adapter/activation/config-store.ts";
import type { CodexLanVoiceServerStatus } from "../../voice/lan/controller.ts";
import { formatVoiceShortcut } from "../../voice/setup.ts";
import {
	getCodexVoiceSystemPromptChangelogPath,
	getCodexVoiceSystemPromptPath,
	REALTIME_SYSTEM_PROMPT_BASENAME,
} from "../../voice/system-prompt.ts";
import { handleAboutTabInput, renderAboutTab } from "./about-tab.ts";
import { openCodexConfigInExternalEditor } from "./config-editor.ts";
import { buildConfigSettings, type ConfigSetting } from "./config-items.ts";
import { SETTINGS_TABS, type SettingsTab } from "./tabs.ts";
import { createUsageTab, type UsageTabOptions } from "./usage-tab.ts";

export interface CodexSettingsScreenOptions extends UsageTabOptions {
	initialConfig: CodexConversionConfig;
	onChange: (nextConfig: CodexConversionConfig) => boolean;
	initialTab?: SettingsTab | undefined;
	lanVoiceServer?:
		| {
				status: () => CodexLanVoiceServerStatus;
				setEnabled: (enabled: boolean) => Promise<CodexLanVoiceServerStatus>;
		  }
		| undefined;
}

export async function openCodexSettingsScreen(
	ctx: ExtensionContext,
	options: CodexSettingsScreenOptions,
): Promise<void> {
	let draft = options.initialConfig;
	let activeTab: SettingsTab = options.initialTab ?? "adapter";
	const availableContextModels = ctx.modelRegistry
		.getAvailable()
		.filter((model) => model.input.includes("text"))
		.map((model) => ({ provider: model.provider, modelId: model.id }));

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const usageTab = createUsageTab(ctx, options, () => tui.requestRender());
		let settingsList: SettingsList;

		const runEditConfig = async () => {
			if (!options.onChange(draft)) {
				ctx.ui.notify(
					"Could not save settings before opening editor",
					"warning",
				);
				return;
			}
			const result = await openCodexConfigInExternalEditor(
				() => tui.stop(),
				() => tui.start(),
				(full) => tui.requestRender(full),
			);
			if (!result.ok) {
				ctx.ui.notify(result.error, "warning");
				return;
			}
			draft = readCodexConversionConfig();
			options.onChange(draft);
			settingsList = createSettingsList();
			tui.requestRender(true);
		};

		const createSettingsList = () => {
			let list: SettingsList;
			const buildSettings = (): ConfigSetting[] => [
				...(activeTab === "voice" && options.lanVoiceServer
					? [
							{
								item: {
									id: "lanVoiceServer",
									label: "LAN voice server",
									currentValue: options.lanVoiceServer.status().running
										? "on"
										: "off",
									values: ["off", "on"],
								},
							},
						]
					: []),
				...buildConfigSettings(activeTab, draft, theme, availableContextModels),
			];
			list = new SettingsList(
				buildSettings().map(({ item }) => item),
				8,
				getSettingsListTheme(),
				(id, value) => {
					const definition = buildSettings().find(({ item }) => item.id === id);
					if (definition?.action === "edit-config") {
						void runEditConfig();
						return;
					}
					if (id === "lanVoiceServer" && options.lanVoiceServer) {
						const previousValue = options.lanVoiceServer.status().running
							? "on"
							: "off";
						void options.lanVoiceServer
							.setEnabled(value === "on")
							.then((status) => {
								list.updateValue(id, status.running ? "on" : "off");
								tui.requestRender();
							})
							.catch(() => {
								list.updateValue(id, previousValue);
								tui.requestRender();
							});
						return;
					}
					if (!definition?.update) return;
					const previousValue = definition.item.currentValue;
					const nextDraft = definition.update(value, draft);
					if (options.onChange(nextDraft)) {
						draft = nextDraft;
						const nextValue = buildSettings().find(({ item }) => item.id === id)
							?.item.currentValue;
						if (nextValue !== undefined) list.updateValue(id, nextValue);
					} else {
						list.updateValue(id, previousValue);
					}
					tui.requestRender();
				},
				() => done(undefined),
			);
			return list;
		};

		const activateTab = (tab: SettingsTab) => {
			activeTab = tab;
			settingsList = createSettingsList();
			if (activeTab === "usage") usageTab.ensureLoaded();
			tui.requestRender();
		};

		settingsList = createSettingsList();
		if (activeTab === "usage") usageTab.ensureLoaded();

		return {
			render: (width: number) => {
				const hasSettingsList = activeTab !== "usage" && activeTab !== "about";
				let settingsLines = hasSettingsList ? settingsList.render(width) : [];
				if (activeTab === "voice")
					settingsLines = withSettingsDetails(
						settingsLines,
						formatVoiceDetails(theme, draft),
					);
				return [
					rule(width, theme, "accent"),
					formatTabs(activeTab, theme),
					rule(width, theme, "borderMuted"),
					...(activeTab === "usage" ? usageTab.render(theme) : []),
					...(activeTab === "about" ? renderAboutTab(theme) : []),
					...(activeTab === "voice"
						? formatVoiceStatus(theme, options.lanVoiceServer?.status())
						: []),
					"",
					...(hasSettingsList
						? withSettingsFooter(settingsLines, theme)
						: [theme.fg("dim", formatFooter(activeTab))]),
					rule(width, theme, "accent"),
				].map((line) => truncateToWidth(line, width, ""));
			},
			invalidate: () => settingsList.invalidate(),
			handleInput: (data: string) => {
				if (data === "\t") {
					const currentIndex = SETTINGS_TABS.findIndex(
						({ id }) => id === activeTab,
					);
					activateTab(
						SETTINGS_TABS[(currentIndex + 1) % SETTINGS_TABS.length]?.id ??
							"adapter",
					);
					return;
				}
				if (activeTab === "about" && handleAboutTabInput(data, ctx)) return;
				if (activeTab === "usage" && usageTab.handleInput(data)) return;
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
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
): string[] {
	return [
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
			`  Change keybinds: ${getCodexConversionConfigPath()} (/reload to apply)`,
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
		return "  Tab to switch sections · R to refresh · Ctrl+R to use reset";
	if (activeTab === "about")
		return "  Tab to switch sections · G/C/D/I to open links · Esc to close";
	return "  Tab to switch sections · Esc to close";
}

function withSettingsFooter(lines: string[], theme: Theme): string[] {
	const next = [...lines];
	for (let index = next.length - 1; index >= 0; index -= 1) {
		if (next[index]?.includes("Enter/Space")) {
			next[index] = theme.fg(
				"dim",
				"  Enter/Space to change · Esc to close · Tab to switch sections",
			);
			break;
		}
	}
	return next;
}

function withSettingsDetails(lines: string[], details: string[]): string[] {
	const next = [...lines];
	const footerIndex = next.findIndex((line) => line.includes("Enter/Space"));
	next.splice(footerIndex < 0 ? next.length : footerIndex, 0, ...details, "");
	return next;
}
