import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, SelectList, type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { listNativeAudioDevices } from "../../voice/devices.ts";

export function nativeDevicePicker(
	kind: "inputDevice" | "outputDevice",
	current: string | undefined,
	done: (value?: string) => void,
	theme: Theme,
	requestRender: () => void,
	customRustBinariesDir?: string,
): Component {
	const abort = new AbortController();
	let select: SelectList | undefined;
	let failure: string | undefined;
	let closed = false;
	const finish = (value?: string) => {
		closed = true;
		abort.abort();
		done(value);
	};
	void listNativeAudioDevices(abort.signal, customRustBinariesDir).then((devices) => {
		if (closed) return;
		const available = kind === "inputDevice" ? devices.inputs : devices.outputs;
		const choices = [
			{ value: "", label: "System default" },
			...available.map((device) => ({
				value: device.id,
				label: device.name + (device.is_default ? " (system default)" : ""),
				description: device.id,
			})),
		];
		if (current && !available.some((device) => device.id === current))
			choices.push({ value: current, label: current + " (saved, unavailable)" });
		select = new SelectList(choices, 8, getSelectListTheme());
		select.setSelectedIndex(choices.findIndex((choice) => choice.value === (current ?? "")));
		select.onSelect = (item) => finish(item.value);
		select.onCancel = () => finish();
		requestRender();
	}).catch((error: unknown) => {
		if (closed) return;
		failure = `${error instanceof Error ? error.message : "Could not list native audio devices"}. Saved selection unchanged · Esc to return`;
		requestRender();
	});
	return {
		render: (width) => [
			...wrapTextWithAnsi(theme.bold(kind === "inputDevice" ? "Microphone" : "Speaker"), width),
			"",
			...(select ? select.render(width) : wrapTextWithAnsi(failure ?? "Loading audio devices… · Esc to cancel", width)),
			"",
			...wrapTextWithAnsi("Applies on the next local voice or dictation start. Browser audio uses browser devices; handed-off audio stays on its source", width),
		],
		invalidate: () => select?.invalidate(),
		handleInput: (data) => {
			if (matchesKey(data, Key.escape)) finish();
			else select?.handleInput(data);
		},
	};
}
