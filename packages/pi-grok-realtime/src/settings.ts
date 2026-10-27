import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { normalizeConfig, readConfig, writeConfig } from "./config.ts";
import { validateAccess } from "./credentials.ts";
import {
	buildGrokSettings,
	type SettingKey,
	settingPatch,
} from "./settings/fields.ts";
import { createSettingsSubmenus } from "./settings/submenus.ts";
import { collectGrokTools } from "./tools.ts";

export async function openSettings(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			"Use /grok local or /grok server. Settings live in grok-realtime.json in the Pi agent directory.",
			"info",
		);
		return;
	}
	let config = readConfig();
	const tools = collectGrokTools(pi).definitions;
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		const tabs = ["Voice", "Context", "Tools", "Help"] as const;
		let activeTab: (typeof tabs)[number] = "Voice";
		let inSubmenu = false;
		const wrap = (text: string, width: number) =>
			new Text(text, 2, 0).render(width);
		const reportError = (error: unknown) =>
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		const { input, chooser, devicePicker } = createSettingsSubmenus(
			theme,
			tui,
			() => config,
			() => {
				inSubmenu = true;
			},
			reportError,
		);
		const settings = buildGrokSettings(config, ctx, { input, chooser });
		const save = (id: SettingKey, value: string) => {
			try {
				// Re-read for each partial patch so remote edits survive the open dialog.
				const updated = normalizeConfig(settingPatch(id, value), readConfig());
				if (id === "access") validateAccess(ctx, updated.access);
				writeConfig(updated);
				if (
					(id === "voiceShortcut" || id === "dictationShortcut") &&
					updated[id] !== config[id]
				)
					ctx.ui.notify("Run /reload to apply shortcut changes", "info");
				config = updated;
			} catch (error) {
				reportError(error);
			}
			tui.requestRender();
		};
		const audioDevices: SettingItem = {
			id: "audioDevices",
			label: "Audio devices",
			currentValue: "",
			submenu: (_current, back) => {
				inSubmenu = true;
				const devices = new SettingsList(
					(["microphone", "speaker"] as const).map((id) => ({
						id,
						label: id === "microphone" ? "Microphone" : "Speaker",
						currentValue: config[id] || "System default",
						submenu: (_value, done) => devicePicker(id)(config[id], done),
					})),
					8,
					getSettingsListTheme(),
					(id, value) => {
						if (id !== "microphone" && id !== "speaker") return;
						save(id, value);
						devices.updateValue(id, config[id] || "System default");
					},
					() => {
						inSubmenu = false;
						back();
					},
				);
				return {
					render: (width) => [
						...wrap(theme.bold("Audio devices"), width),
						"",
						...devices
							.render(width)
							.filter((line) => !line.includes("Enter/Space")),
						"",
						...wrap(
							theme.fg(
								"dim",
								"Local audio only; browser audio uses browser devices",
							),
							width,
						),
					],
					invalidate: () => devices.invalidate(),
					handleInput: (data) => devices.handleInput(data),
				};
			},
		};
		const tabFor = (id: SettingKey) =>
			id === "contextModel" || id === "contextReasoning"
				? "Context"
				: id === "webSearch"
					? "Tools"
					: "Voice";
		const createList = (): SettingsList =>
			new SettingsList(
				[
					...(activeTab === "Voice" ? [audioDevices] : []),
					...settings
						.filter((item) => tabFor(item.id) === activeTab)
						.map((item) => ({
							...item,
							currentValue:
								item.id === "webSearch" || item.id === "autoResume"
									? config[item.id]
										? "on"
										: "off"
									: String(config[item.id]),
							...(item.submenu
								? {
										submenu: (
											current: string,
											back: Parameters<NonNullable<SettingItem["submenu"]>>[1],
										) =>
											item.submenu!(current, (value, options) => {
												inSubmenu = false;
												back(value, options);
											}),
									}
								: {}),
						})),
				],
				8,
				getSettingsListTheme(),
				(id, value) => {
					const setting = settings.find((item) => item.id === id);
					if (!setting) return;
					save(setting.id, value);
					for (const item of settings)
						list.updateValue(
							item.id,
							item.id === "webSearch" || item.id === "autoResume"
								? config[item.id]
									? "on"
									: "off"
								: String(config[item.id]),
						);
					tui.requestRender();
				},
				() => done(undefined),
			);
		let list = createList();
		return {
			render: (width) =>
				[
					theme.fg("accent", "─".repeat(Math.max(0, width))),
					...wrap(
						tabs
							.map((tab) =>
								tab === activeTab ? theme.bold(tab) : theme.fg("dim", tab),
							)
							.join(`  ${theme.fg("dim", "/")}  `),
						width,
					),
					theme.fg("borderMuted", "─".repeat(Math.max(0, width))),
					...wrap(
						theme.fg(
							"dim",
							"Grok realtime · settings apply to the next call; /reload applies shortcuts",
						),
						width,
					),
					"",
					...(activeTab === "Help"
						? wrap(
								"/grok local · start local voice\n/grok server · toggle browser control\n/grok mute · toggle microphone mute\n/grok stop · stop voice and browser control\n/grok dictate · start/finish dictation into the editor\n/grok cancel · discard dictation\nVoice shortcut: " +
									(config.voiceShortcut || "disabled") +
									" · toggle voice\nDictation shortcut: " +
									(config.dictationShortcut || "disabled") +
									" · start/finish dictation\n/reload · apply changed shortcuts and extension tools\n\nAPI billing\nVoice: connected time (including silence) and billable text inputs, including context updates.\nDictation: separate speech-to-text pricing or account allowance.\nContext summaries: selected model pricing or subscription allowance.\nhttps://docs.x.ai/developers/models/speech-to-speech\n\nPersonality instructions · Markdown\nAppended global, then project; applies to the next call.\nGlobal: " +
									join(getAgentDir(), "GROK-REALTIME-SYSTEM-PROMPT.md") +
									"\nProject: " +
									join(
										ctx.cwd,
										CONFIG_DIR_NAME,
										"GROK-REALTIME-SYSTEM-PROMPT.md",
									),
								width,
							)
						: list
								.render(width)
								.filter((line) => !line.includes("Enter/Space"))),
					...(activeTab === "Tools"
						? wrap(
								"\nRegistered voice tools · read-only\n" +
									(tools.length
										? tools
												.map((tool) => `${tool.name} · ${tool.description}`)
												.join("\n")
										: "No custom voice tools registered") +
									"\nRegister tools in an extension, then /reload",
								width,
							)
						: []),
					"",
					...wrap(
						theme.fg(
							"dim",
							`${activeTab === "Help" ? "" : inSubmenu ? "Enter select/save · Esc back · " : "Enter/Space change · "}Tab/Shift+Tab sections${inSubmenu ? " (discard edit)" : " · Esc close"}`,
						),
						width,
					),
					theme.fg("accent", "─".repeat(Math.max(0, width))),
				].map((line) => truncateToWidth(line, width, "")),
			invalidate: () => list.invalidate(),
			handleInput(data) {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab))) {
					const direction = matchesKey(data, Key.tab) ? 1 : -1;
					activeTab =
						tabs[
							(tabs.indexOf(activeTab) + direction + tabs.length) % tabs.length
						]!;
					inSubmenu = false;
					list = createList();
				} else if (activeTab === "Help") {
					if (matchesKey(data, Key.escape)) done(undefined);
				} else {
					list.handleInput(data);
				}
				tui.requestRender();
			},
		};
	});
}
