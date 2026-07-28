import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import {
	type GippityControlConfig,
	normalizeRealtimeV3Voice,
	REALTIME_V3_VOICES,
} from "./config.ts";
import { getGippityControlConfigPath } from "./config-store.ts";
import type { CodexLanVoiceServerController } from "./voice/lan/controller.ts";
import { formatVoiceShortcut } from "./voice/setup.ts";
import {
	getCodexVoiceSystemPromptPath,
	REALTIME_SYSTEM_PROMPT_BASENAME,
} from "./voice/system-prompt.ts";

interface Setting {
	id: string;
	label: string;
	currentValue: string;
	values: string[];
	update?(value: string, config: GippityControlConfig): GippityControlConfig;
}

export async function openGippitySettings(options: {
	ctx: ExtensionContext;
	initialConfig: GippityControlConfig;
	lanVoice: CodexLanVoiceServerController;
	onChange(config: GippityControlConfig): boolean;
}): Promise<void> {
	const { ctx, lanVoice, onChange } = options;
	let config = options.initialConfig;
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		let list: SettingsList;
		const buildSettings = (): Setting[] => [
			{
				id: "server",
				label: "Control server",
				currentValue: lanVoice.status().running ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "voice",
				label: "Voice",
				currentValue: formatVoiceName(config.voice.v3Voice),
				values: REALTIME_V3_VOICES.map(formatVoiceName),
				update: (value, current) => ({
					...current,
					voice: {
						...current.voice,
						v3Voice:
							normalizeRealtimeV3Voice(value.toLowerCase()) ??
							current.voice.v3Voice,
					},
				}),
			},
			{
				id: "dictationMode",
				label: "Dictation key behavior",
				currentValue:
					config.voice.dictationShortcutMode === "push"
						? "push to dictate"
						: "toggle",
				values: ["push to dictate", "toggle"],
				update: (value, current) => ({
					...current,
					voice: {
						...current.voice,
						dictationShortcutMode: value === "toggle" ? "toggle" : "push",
					},
				}),
			},
		];
		const createList = () => {
			let next!: SettingsList;
			next = new SettingsList(
				buildSettings().map(({ id, label, currentValue, values }) => ({
					id,
					label,
					currentValue,
					values,
				})),
				8,
				getSettingsListTheme(),
				(id, value) => {
					if (id === "server") {
						const previous = lanVoice.status().running;
						void lanVoice
							.setEnabled(value === "on", ctx)
							.then((status) => {
								next.updateValue(id, status.running ? "on" : "off");
								tui.requestRender();
							})
							.catch((error: unknown) => {
								next.updateValue(id, previous ? "on" : "off");
								ctx.ui.notify(
									`Could not ${value === "on" ? "start" : "stop"} GipPity: ${error instanceof Error ? error.message : String(error)}`,
									"error",
								);
								tui.requestRender();
							});
						return;
					}
					const setting = buildSettings().find((item) => item.id === id);
					if (!setting?.update) return;
					const updated = setting.update(value, config);
					if (onChange(updated)) config = updated;
					else next.updateValue(id, setting.currentValue);
					tui.requestRender();
				},
				() => done(undefined),
			);
			return next;
		};
		list = createList();
		return {
			render(width: number) {
				return [
					rule(width, theme),
					`  ${theme.bold("GipPity")}  ${theme.fg("dim", "remote control")}`,
					rule(width, theme),
					...list.render(width),
					...details(theme, config, lanVoice),
					rule(width, theme),
				].map((line) => truncateToWidth(line, width, ""));
			},
			invalidate: () => list.invalidate(),
			handleInput(data: string) {
				list.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}

function details(
	theme: Theme,
	config: GippityControlConfig,
	lanVoice: CodexLanVoiceServerController,
): string[] {
	const status = lanVoice.status();
	return [
		"",
		theme.fg(
			"dim",
			`  Realtime voice: ${formatVoiceShortcut(config.voice.realtimeShortcut)}`,
		),
		theme.fg(
			"dim",
			`  Dictation: ${formatVoiceShortcut(config.voice.dictationShortcut)}`,
		),
		theme.fg(
			"dim",
			`  Control server: ${formatVoiceShortcut(config.voice.serverShortcut)}`,
		),
		theme.fg(
			"dim",
			`  Change keybinds/devices: ${getGippityControlConfigPath()} (/reload to apply)`,
		),
		"",
		...(status.running
			? [
					theme.fg("accent", "  Control server is running"),
					...status.urls.map((url) => theme.fg("dim", `  ${url}`)),
				]
			: [
					theme.fg(
						"dim",
						"  Control server belongs to this Pi session and stops when it changes",
					),
				]),
		"",
		theme.fg(
			"dim",
			`  Realtime System Prompt: ${getCodexVoiceSystemPromptPath()}`,
		),
		theme.fg(
			"dim",
			`  Folder-level: create ${CONFIG_DIR_NAME}/${REALTIME_SYSTEM_PROMPT_BASENAME} (appends to global)`,
		),
		"",
		theme.fg("dim", "  Enter/Space to change · Esc to close"),
	];
}

function formatVoiceName(voice: string): string {
	return `${voice.slice(0, 1).toUpperCase()}${voice.slice(1)}`;
}

function rule(width: number, theme: Theme): string {
	return theme.fg("accent", "─".repeat(Math.max(0, width)));
}
