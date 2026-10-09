import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	getSelectListTheme,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	Key,
	matchesKey,
	SelectList,
	type SettingItem,
	SettingsList,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { listAudioDevices } from "./audio/devices.ts";
import {
	CONTEXT_REASONING,
	type GrokRealtimeConfig,
	MODELS,
	normalizeConfig,
	readConfig,
	SPEEDS,
	VOICES,
	writeConfig,
} from "./config.ts";
import { validateAccess } from "./credentials.ts";
import { collectGrokTools } from "./tools.ts";

type SettingKey = Exclude<keyof GrokRealtimeConfig, "port">;

function settingPatch(id: SettingKey, value: string): unknown {
	const trimmed = value.trim();
	return {
		[id]:
			id === "webSearch" || id === "autoResume"
				? trimmed === "on"
				: (id === "speed" || id === "silenceSeconds") && trimmed
					? Number(trimmed)
					: trimmed,
	};
}

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
		const input = (
			id: SettingKey,
			title: string,
			current: string,
			submit: (value: string) => void,
			cancel: () => void,
		): Component => {
			inSubmenu = true;
			const editor = new Input();
			editor.setValue(current);
			editor.focused = true;
			editor.onEscape = cancel;
			editor.onSubmit = (value) => {
				try {
					normalizeConfig(settingPatch(id, value), config);
					submit(value.trim());
				} catch (error) {
					reportError(error);
				}
			};
			return {
				render: (width) => [
					...wrap(theme.bold(title), width),
					"",
					...editor.render(width),
				],
				invalidate: () => editor.invalidate(),
				handleInput: (data) => editor.handleInput(data),
			};
		};
		const chooser =
			(
				id: SettingKey,
				title: string,
				values: readonly string[],
				customLabel: string,
			): NonNullable<SettingItem["submenu"]> =>
			(current, back) => {
				inSubmenu = true;
				let editor: Component | undefined;
				const choices = [...new Set([...values, current])];
				const custom = { value: "", label: customLabel };
				const select = new SelectList(
					[...choices.map((value) => ({ value, label: value })), custom],
					8,
					getSelectListTheme(),
				);
				select.setSelectedIndex(choices.indexOf(current));
				select.onCancel = () => back();
				select.onSelect = (item) => {
					// Object identity leaves every custom account ID available.
					if (item === custom)
						editor = input(id, customLabel, current, back, () => {
							editor = undefined;
						});
					else back(item.value);
				};
				return {
					render: (width) =>
						editor
							? editor.render(width)
							: [
									...wrap(theme.bold(title), width),
									"",
									...select.render(width),
								],
					invalidate: () => (editor ?? select).invalidate(),
					handleInput: (data) => (editor ?? select).handleInput?.(data),
				};
			};
		const devicePicker =
			(id: "microphone" | "speaker"): NonNullable<SettingItem["submenu"]> =>
			(current, back) => {
				inSubmenu = true;
				let select: SelectList | undefined;
				let failure: string | undefined;
				let closed = false;
				void listAudioDevices(id)
					.then((devices) => {
						if (closed) return;
						const choices = [
							{ value: "", label: "System default" },
							...devices.map((device) => ({
								value: device.name,
								label: device.description || device.name,
								description: device.name,
							})),
						];
						if (current && !devices.some((device) => device.name === current))
							choices.push({
								value: current,
								label: `${current} (saved, unavailable)`,
							});
						select = new SelectList(choices, 8, getSelectListTheme());
						select.setSelectedIndex(
							choices.findIndex((choice) => choice.value === current),
						);
						select.onCancel = () => {
							closed = true;
							back();
						};
						select.onSelect = (item) => {
							closed = true;
							back(item.value);
						};
						tui.requestRender();
					})
					.catch((error: unknown) => {
						if (closed) return;
						failure = error instanceof Error ? error.message : String(error);
						tui.requestRender();
					});
				return {
					render: (width) => [
						...wrap(
							theme.bold(id === "microphone" ? "Microphone" : "Speaker"),
							width,
						),
						"",
						...(select
							? select.render(width)
							: wrap(failure ?? "Loading audio devices…", width)),
					],
					invalidate: () => select?.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, Key.escape)) {
							closed = true;
							back();
						} else select?.handleInput(data);
					},
				};
			};
		const settings: (SettingItem & { id: SettingKey })[] = [
			{
				id: "access",
				label: "Pi xAI access",
				currentValue: config.access,
				values: ["oauth", "api_key"],
				description:
					"Uses the matching active Pi credential for voice and dictation",
			},
			{
				id: "autoResume",
				label: "Resume dropped voice calls",
				currentValue: config.autoResume ? "on" : "off",
				values: ["off", "on"],
				description: "One replacement attempt after an established call drops",
			},
			...(["voiceShortcut", "dictationShortcut"] as const).map((id) => ({
				id,
				label: id === "voiceShortcut" ? "Voice shortcut" : "Dictation shortcut",
				currentValue: config[id],
				description: "Run /reload after changing; empty disables",
				submenu: (current: string, back: (value?: string) => void) =>
					input(
						id,
						"Pi shortcut · empty disables · /reload after changing",
						current,
						back,
						() => back(),
					),
			})),
			{
				id: "contextModel",
				label: "Context summary model",
				currentValue: config.contextModel,
				submenu: chooser(
					"contextModel",
					"Context summary model",
					[
						"current",
						"off",
						...ctx.modelRegistry
							.getAvailable()
							.map((model) => `${model.provider}/${model.id}`),
					],
					"Enter provider/modelId…",
				),
			},
			{
				id: "contextReasoning",
				label: "Context summary reasoning",
				currentValue: config.contextReasoning,
				values: [...CONTEXT_REASONING],
			},
			{
				id: "voice",
				label: "Voice",
				currentValue: config.voice,
				submenu: chooser(
					"voice",
					"Voice · availability depends on your account",
					VOICES,
					"Enter custom voice ID…",
				),
			},
			{
				id: "model",
				label: "Model",
				currentValue: config.model,
				submenu: chooser(
					"model",
					"Realtime model · availability depends on your account",
					MODELS,
					"Enter custom model ID…",
				),
			},
			{
				id: "reasoning",
				label: "Reasoning",
				currentValue: config.reasoning,
				values: ["high", "none"],
			},
			{
				id: "webSearch",
				label: "Native web search",
				currentValue: config.webSearch ? "on" : "off",
				values: ["off", "on"],
				description:
					"xAI executes searches directly, bypassing Pi. Extra provider tool charges apply.",
			},
			{
				id: "speed",
				label: "Speed",
				currentValue: String(config.speed),
				submenu: chooser(
					"speed",
					"Speech speed",
					SPEEDS.map(String),
					"Enter speed…",
				),
			},
			{
				id: "language",
				label: "Language",
				currentValue: config.language,
				submenu: (current, back) =>
					input("language", "Language: auto or BCP 47 tag", current, back, () =>
						back(),
					),
			},
			{
				id: "silenceSeconds",
				label: "Follow-up after silence (seconds)",
				currentValue: String(config.silenceSeconds),
				description: "0 turns follow-up off",
				submenu: (current, back) =>
					input(
						"silenceSeconds",
						"Follow-up after silence in seconds: 0 off",
						current,
						back,
						() => back(),
					),
			},
		];
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
