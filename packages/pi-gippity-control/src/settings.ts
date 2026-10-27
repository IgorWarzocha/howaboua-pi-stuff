import { isAbsolute } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_GIPPITY_LAN_PORT,
	type GippityControlConfig,
	type VoiceContextModel,
} from "./config.ts";
import { getGippityControlConfigPath } from "./config-store.ts";
import { buildGippitySettings } from "./settings/fields.ts";
import type { CodexLanVoiceServerController } from "./voice/lan/controller.ts";
import { formatVoiceShortcut } from "./voice/setup.ts";
import {
	getCodexVoiceSystemPromptChangelogPath,
	getCodexVoiceSystemPromptPath,
	REALTIME_SYSTEM_PROMPT_BASENAME,
} from "./voice/system-prompt.ts";

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
		const contextModels = new Map<string, VoiceContextModel>();
		for (const model of ctx.modelRegistry.getAvailable()) {
			if (!model.input.includes("text")) continue;
			const value = `${model.provider}/${model.id}`;
			contextModels.set(value, { provider: model.provider, modelId: model.id });
		}
		const buildSettings = () =>
			buildGippitySettings(config, lanVoice, contextModels, theme, tui);
		const createList = () => {
			let next!: SettingsList;
			next = new SettingsList(
				buildSettings().map(({ update: _update, ...item }) => item),
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
					if (onChange(updated)) {
						config = updated;
						next.updateValue(
							id,
							buildSettings().find((item) => item.id === id)?.currentValue ??
								value,
						);
					} else next.updateValue(id, setting.currentValue);
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
	const dim = (text: string) => theme.fg("dim", `  ${text}`);
	const customPath = config.lan.customWebAppPath;
	const webApp = config.lan.customWebApp
		? `custom ${customPath ? (isAbsolute(customPath) ? "global" : "per-directory") : "discovery"}`
		: "bundled GipPity";
	return [
		"",
		dim(
			`Audio: input ${config.voice.inputDevice ?? "system default"} · output ${config.voice.outputDevice ?? "system default"}`,
		),
		dim(
			`Shortcuts: realtime ${formatVoiceShortcut(config.voice.realtimeShortcut)} · mute ${formatVoiceShortcut(config.voice.muteShortcut)}`,
		),
		dim(
			`           dictation ${formatVoiceShortcut(config.voice.dictationShortcut)} · server ${formatVoiceShortcut(config.voice.serverShortcut)}`,
		),
		dim(
			`Web app: ${webApp} · port ${config.lan.port ?? DEFAULT_GIPPITY_LAN_PORT} (set lan.port in config)${config.lan.customWebApp ? ` · ${customPath ?? "app discovery JSON"}` : ""}`,
		),
		dim(
			`Config (/reload after keybind/port edits): ${getGippityControlConfigPath()}`,
		),
		dim("Realtime compaction refresh uses the selected Voice context model"),
		...(status.running
			? [
					theme.fg(
						"accent",
						"  Control server running · stops when this Pi session changes",
					),
					...status.urls.map((url) => dim(url)),
				]
			: [dim("Control server is session-owned · stops with this Pi session")]),
		"",
		dim(`Realtime prompt: ${getCodexVoiceSystemPromptPath()}`),
		dim(
			`Project prompt append: ${CONFIG_DIR_NAME}/${REALTIME_SYSTEM_PROMPT_BASENAME}`,
		),
		dim(`Prompt changelog: ${getCodexVoiceSystemPromptChangelogPath()}`),
		"",
		dim("Enter/Space to change · Esc to close"),
	];
}

function rule(width: number, theme: Theme): string {
	return theme.fg("accent", "─".repeat(Math.max(0, width)));
}
