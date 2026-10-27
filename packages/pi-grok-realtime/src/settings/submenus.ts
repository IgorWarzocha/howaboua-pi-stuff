import {
	getSelectListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	Key,
	matchesKey,
	SelectList,
	type SettingItem,
	Text,
} from "@earendil-works/pi-tui";
import { listAudioDevices } from "../audio/devices.ts";
import { type GrokRealtimeConfig, normalizeConfig } from "../config.ts";
import { type SettingKey, settingPatch } from "./fields.ts";
export function createSettingsSubmenus(
	theme: Theme,
	tui: { requestRender(): void },
	getConfig: () => GrokRealtimeConfig,
	enterSubmenu: () => void,
	reportError: (error: unknown) => void,
) {
	const wrap = (text: string, width: number) =>
		new Text(text, 2, 0).render(width);
	const input = (
		id: SettingKey,
		title: string,
		current: string,
		submit: (value: string) => void,
		cancel: () => void,
	): Component => {
		enterSubmenu();
		const editor = new Input();
		editor.setValue(current);
		editor.focused = true;
		editor.onEscape = cancel;
		editor.onSubmit = (value) => {
			try {
				normalizeConfig(settingPatch(id, value), getConfig());
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
			enterSubmenu();
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
						: [...wrap(theme.bold(title), width), "", ...select.render(width)],
				invalidate: () => (editor ?? select).invalidate(),
				handleInput: (data) => (editor ?? select).handleInput?.(data),
			};
		};
	const devicePicker =
		(id: "microphone" | "speaker"): NonNullable<SettingItem["submenu"]> =>
		(current, back) => {
			enterSubmenu();
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
	return { input, chooser, devicePicker };
}
