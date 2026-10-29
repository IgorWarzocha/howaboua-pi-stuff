import { getSettingsListTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type TUI } from "@earendil-works/pi-tui";
import { normalizeVoiceApiProvider } from "../../../adapter/activation/config.ts";
import type { CodexConversionConfig, VoiceContextModel, LunaCacheKeepaliveMinutes } from "../../../adapter/activation/config.ts";
import type { ExecutionMode } from "../../../adapter/activation/execution-mode.ts";
import type { CodexSettingsScreenOptions } from "../screen.ts";
import { openCodexConfigInExternalEditor } from "../config-editor.ts";
import { buildConfigSettings, type ConfigSetting } from "../config-items.ts";
import { ChoiceSettingSubmenu, TextSettingSubmenu } from "../config-items-shared.ts";
import type { SettingsTab } from "../tabs.ts";
import { nativeDevicePicker } from "../native-device-picker.ts";
import { contextWindowPicker } from "../context-window-picker.ts";

export function createSettingsConfiguration(
	ctx: ExtensionContext,
	options: CodexSettingsScreenOptions,
	tui: TUI,
	theme: Theme,
	done: (result: void) => void,
	availableContextModels: VoiceContextModel[],
) {
	let draft = options.initialConfig;
	let activeTab: SettingsTab = options.initialTab ?? "adapter";
	let settingsList: SettingsList;
	let devicePickerOpen = false;
	let contextWindowPickerOpen = false;
	let retentionPickerOpen = false;
	let apiProviderPickerOpen = false;

	const runEditConfig = async () => {
		if (!options.onChange(draft)) {
			ctx.ui.notify(
				"Could not save settings before opening editor",
				"warning",
			);
			return;
		}
		const result = await openCodexConfigInExternalEditor(
			options.configScope.path(),
			options.configScope.current() === "folder",
			() => tui.stop(),
			() => tui.start(),
			(full) => tui.requestRender(full),
		);
		if (!result.ok) {
			ctx.ui.notify(result.error, "warning");
			return;
		}
		draft = options.configScope.reload();
		options.onChange(draft);
		settingsList = createSettingsList();
		tui.requestRender(true);
	};

	const createSettingsList = () => {
		let list: SettingsList;
		const buildSettings = (): ConfigSetting[] => [
			{
				item: {
					id: "configScope",
					description: "Choose where changes are saved. Switching to Global removes this project\u0027s overrides.",
					label: "Editing",
					currentValue: options.configScope.current() === "folder" ? "This project" : "Global",
					values: options.configScope.canUseFolder
						? ["Global", "This project"]
						: ["Global"],
				},
			},
			...(activeTab === "adapter"
				? [{
						item: {
							id: "executionMode",
							description: "Structured: standard JSON schemas. Code: JavaScript. Notebook: persistent Deno shell with checkpoints. TS: persistent TypeScript with concurrent cells. JS Notebook: persistent JavaScript with full VM checkpoints.",
							label: "Execution mode",
							currentValue: formatExecutionMode(draft.executionMode),
							values: ["Structured", "Code", "Notebook (recommended)", "TS", "JS Notebook"],
						},
						update: (value: string, current: CodexConversionConfig) => ({
							...current,
							executionMode: parseExecutionMode(value),
						}),
					}]
				: []),
			...(activeTab === "voice" && options.lanVoiceServer
				? [
						{
							item: {
								id: "lanVoiceServer",
								description: "Serve this session\u0027s voice interface to a browser on your local network. Stops when the session changes.",
								label: "LAN voice server",
								currentValue: options.lanVoiceServer.status().running
									? "on"
									: "off",
								values: ["off", "on"],
							},
						},
					]
				: []),
			...buildConfigSettings(
				activeTab,
				draft,
				theme,
				availableContextModels,
				ctx,
				options.hasWebSearch?.(),
			).map((definition): ConfigSetting => {
				if (definition.item.id === "apiProvider") return {
					...definition, item: { ...definition.item, submenu: (value, back) => {
						apiProviderPickerOpen = true;
						return new TextSettingSubmenu(definition.item.label, definition.item.description, value, (selected) => {
							if (!normalizeVoiceApiProvider(selected)) {
								ctx.ui.notify("Enter a name, at most 512 bytes, without surrounding whitespace or control characters.", "error");
								return;
							}
							apiProviderPickerOpen = false;
							back(selected);
						}, () => { apiProviderPickerOpen = false; back(); }, theme);
					} },
				};
				if (definition.action !== "global-notebook-journals" && definition.action !== "global-notebook-checkpoint-cleanup") return definition;
				return {
					...definition,
					item: {
						...definition.item,
						submenu: (value, back) => {
							retentionPickerOpen = true;
							return new ChoiceSettingSubmenu(definition.item, value, (selected) => {
								retentionPickerOpen = false;
								back(selected);
							}, theme);
						},
					},
				};
			}),
			...(activeTab === "context" ? [{ item: {
				id: "contextWindows", label: "Context windows (openai-codex)", currentValue: "",
				description: "Set local capacity per model in Pi models.json. Global, regardless of the Editing scope above.",
				submenu: (_value: string, back: () => void) => {
					contextWindowPickerOpen = true;
					return contextWindowPicker(ctx, theme, options.setModel, options.waitForIdle, () => { contextWindowPickerOpen = false; back(); });
				},
			} }] : []),
			...(activeTab === "voice"
				? (["inputDevice", "outputDevice"] as const).map((key): ConfigSetting => ({
						item: {
							id: key,
							label: key === "inputDevice" ? "Microphone" : "Speaker",
							description: "Native audio only; applies on the next local start. Browser and handed-off audio keep their own devices.",
							currentValue: draft.voice[key] ?? "System default",
							submenu: (_value, back) => {
								devicePickerOpen = true;
								return nativeDevicePicker(key, draft.voice[key], (value) => {
									devicePickerOpen = false;
									back(value);
								}, theme, () => tui.requestRender(), draft.tools.customRustBinariesDir);
							},
						},
						update: (value, current) => {
							const voice = { ...current.voice, audioSetupCompleted: true };
							if (value) voice[key] = value;
							else delete voice[key];
							return { ...current, voice };
						},
					}))
				: []),
		];
		list = new SettingsList(
			buildSettings().map(({ item }) => item),
			8,
			getSettingsListTheme(),
			(id, value) => {
				const definition = buildSettings().find(({ item }) => item.id === id);
				if (definition?.action === "edit-config" || (id === "taskBoundaryReminder" && value === "custom (edit JSON)")) {
					void runEditConfig();
					return;
				}
				if (definition?.action === "project-cache-keepalive") {
					const interval = value === "off" ? draft.openai.cacheKeepaliveIntervalMinutes : value === "55 mins" ? 55 : 25;
					const nextDraft = options.onProjectCacheKeepalive(value !== "off", interval);
					if (nextDraft) {
						draft = nextDraft;
						for (const { item } of buildSettings()) list.updateValue(item.id, item.currentValue);
					} else {
						list.updateValue(id, definition.item.currentValue);
					}
					tui.requestRender();
					return;
				}
				if (definition?.action === "global-notebook-journals") {
					const nextDraft = options.onGlobalNotebookJournals(value === "Off & remove" ? "off" : value === "On" ? "on" : "week");
					if (nextDraft) {
						draft = nextDraft;
						for (const { item } of buildSettings()) list.updateValue(item.id, item.currentValue);
					} else list.updateValue(id, definition.item.currentValue);
					tui.requestRender();
					return;
				}
				if (definition?.action === "global-notebook-checkpoint-cleanup") {
					const nextDraft = options.onGlobalNotebookCheckpointCleanup(value === "1 month" ? "month" : value === "1 week" ? "week" : "never");
					if (nextDraft) {
						draft = nextDraft;
						for (const { item } of buildSettings()) list.updateValue(item.id, item.currentValue);
					} else list.updateValue(id, definition.item.currentValue);
					tui.requestRender();
					return;
				}
				if (definition?.action === "global-luna-cache-keepalive" || definition?.action === "global-luna-cache-keepalive-interval") {
					const editingInterval = definition.action === "global-luna-cache-keepalive-interval";
					const minutes = editingInterval ? draft.openai.lunaCacheKeepaliveMinutes
						: (value === "off" ? 0 : Number.parseInt(value, 10)) as LunaCacheKeepaliveMinutes;
					const interval = editingInterval ? (value === "4.5 mins" ? 4.5 : 2.5) : draft.openai.lunaCacheKeepaliveIntervalMinutes;
					const nextDraft = options.onGlobalLunaCacheKeepalive(minutes, interval);
					if (nextDraft) {
						draft = nextDraft;
						for (const { item } of buildSettings()) list.updateValue(item.id, item.currentValue);
					} else {
						list.updateValue(id, definition.item.currentValue);
					}
					tui.requestRender();
					return;
				}
				if (id === "configScope") {
					const previousValue = options.configScope.current() === "folder" ? "This project" : "Global";
					const nextDraft = options.configScope.set(value === "This project" ? "folder" : "global");
					if (nextDraft) {
						draft = nextDraft;
						settingsList = createSettingsList();
					} else {
						list.updateValue(id, previousValue);
					}
					tui.requestRender(true);
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
					if (activeTab === "context" || id === "voiceModel") {
						settingsList = createSettingsList();
						settingsList.selectItem(id);
					} else {
						for (const { item } of buildSettings())
							list.updateValue(item.id, item.currentValue);
					}
				} else {
					list.updateValue(id, previousValue);
				}
				tui.requestRender();
			},
			() => done(undefined),
		);
		return list;
	};

	settingsList = createSettingsList();
	return {
		get draft() { return draft; },
		get activeTab() { return activeTab; },
		get list() { return settingsList; },
		get contextWindowPickerOpen() { return contextWindowPickerOpen; },
		get retentionPickerOpen() { return retentionPickerOpen; },
		get pickerOpen() { return devicePickerOpen || contextWindowPickerOpen || retentionPickerOpen || apiProviderPickerOpen; },
		activateTab(tab: SettingsTab) {
			activeTab = tab;
			settingsList = createSettingsList();
		},
	};
}

export type SettingsConfiguration = ReturnType<typeof createSettingsConfiguration>;

function formatExecutionMode(mode: ExecutionMode): string {
	if (mode === "js") return "JS Notebook";
	if (mode === "ts") return "TS";
	if (mode === "code") return "Code";
	if (mode === "notebook") return "Notebook (recommended)";
	return "Structured";
}

function parseExecutionMode(value: string): ExecutionMode {
	if (value === "JS Notebook") return "js";
	if (value === "TS") return "ts";
	if (value === "Code") return "code";
	if (value === "Notebook (recommended)") return "notebook";
	return "normal";
}
