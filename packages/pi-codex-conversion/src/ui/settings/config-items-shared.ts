import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Focusable,
	Input,
	type SettingItem,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type { CodexConversionConfig, CacheKeepaliveIntervalMinutes } from "../../adapter/activation/config.ts";

export interface ConfigSetting {
	item: SettingItem & { description: string };
	update?:
		| ((value: string, config: CodexConversionConfig) => CodexConversionConfig)
		| undefined;
	action?: "edit-config" | "global-notebook-journals" | "global-notebook-checkpoint-cleanup" | "global-luna-cache-keepalive" | "global-luna-cache-keepalive-interval" | "project-cache-keepalive" | undefined;
}

export class TextSettingSubmenu extends Container implements Focusable {
	private input: Input;

	constructor(
		title: string,
		description: string,
		currentValue: string,
		onSubmit: (value: string) => void,
		onCancel: () => void,
		theme: Theme,
	) {
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
		this.addChild(
			new Text(theme.fg("dim", "  Enter to save · Esc to cancel"), 0, 0),
		);
	}

	get focused(): boolean {
		return this.input.focused;
	}
	set focused(value: boolean) {
		this.input.focused = value;
	}
	handleInput(data: string): void {
		this.input.handleInput(data);
	}
}

export function setting(
	item: ConfigSetting["item"],
	update?: ConfigSetting["update"],
): ConfigSetting {
	return { item, ...(update ? { update } : {}) };
}

export function toggle(
	id: string,
	label: string,
	current: boolean,
	update: (
		enabled: boolean,
		config: CodexConversionConfig,
	) => CodexConversionConfig,
	description: string,
): ConfigSetting {
	return setting(
		{ id, label, currentValue: current ? "on" : "off", values: ["off", "on"], description },
		(value, config) => update(value === "on", config),
	);
}

export function projectCacheKeepalive(id: string, label: string, current: boolean, interval: CacheKeepaliveIntervalMinutes): ConfigSetting {
	return {
		item: {
			id, label, currentValue: current ? `${interval} mins` : "off", values: ["off", "25 mins", "55 mins"],
			description: "Request interval for Astra, Sol and Terra across versions in this project. Uses quota. Cache retention is not guaranteed.",
		},
		action: "project-cache-keepalive",
	};
}
