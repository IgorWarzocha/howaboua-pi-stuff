import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type CodexConversionConfig,
	normalizeProviderList,
} from "../../adapter/activation/config.ts";
import { editorCommand } from "./config-editor.ts";
import {
	type ConfigSetting,
	setting,
	TextSettingSubmenu,
} from "./config-items-shared.ts";

export function buildAdapterSettings(
	config: CodexConversionConfig,
	theme: Theme,
): ConfigSetting[] {
	return [
		setting(
			{
				id: "allProviders",
				description: "Choose which models use the Codex adapter.",
				label: "Provider scope",
				currentValue: formatAllProvidersMode(config.scope.allProviders),
				values: ["Codex and configured", "all providers"],
			},
			(value, current) => ({
				...current,
				scope: {
					...current.scope,
					allProviders: parseAllProvidersMode(value),
				},
			}),
		),
		setting(
			{
				id: "additionalProviders",
				description:
					"Provider IDs for compatible Responses endpoints, including passthrough proxies, that should use the adapter.",
				label: "Additional providers",
				currentValue: config.scope.additionalProviders.join(", "),
				submenu: (currentValue, done) =>
					new TextSettingSubmenu(
						"Additional providers",
						"Comma-separated provider ids that should use the adapter.",
						currentValue,
						(value) => done(normalizeCodexProviderText(value)),
						() => done(),
						theme,
					),
			},
			(value, current) => ({
				...current,
				scope: {
					...current.scope,
					additionalProviders: normalizeProviderList(value.split(",")),
				},
			}),
		),
		setting(
			{
				id: "heavySystemPromptOverwrite",
				description:
					"Replace Pi’s default instructions with compact guidance. Keeps instructions from other extensions.",
				label: "Heavy system prompt overwrite",
				currentValue: config.prompt.heavySystemPromptOverwrite ? "on" : "off",
				values: ["off", "on"],
			},
			(value, current) => ({
				...current,
				prompt: {
					...current.prompt,
					heavySystemPromptOverwrite: value === "on",
				},
			}),
		),
		setting(
			{
				id: "currentTimeReminderMinutes",
				label: "Current time reminders",
				description:
					"Include UTC time on the first inference and at the chosen interval. Never starts a turn.",
				currentValue:
					config.prompt.currentTimeReminderMinutes === 0
						? "off"
						: `${config.prompt.currentTimeReminderMinutes} mins`,
				values: ["off", "30 mins", "60 mins"],
			},
			(value, current) => ({
				...current,
				prompt: {
					...current.prompt,
					currentTimeReminderMinutes:
						value === "30 mins" ? 30 : value === "60 mins" ? 60 : 0,
				},
			}),
		),
		{
			item: {
				id: "editConfig",
				description:
					"Open the selected scope's config file in your editor for settings not exposed here.",
				label: "Edit config",
				currentValue: editorCommand()
					? "Opens in default editor (please /reload)"
					: "Set $EDITOR",
				values: editorCommand() ? ["Open"] : ["Unavailable"],
			},
			action: "edit-config",
		},
	];
}

function formatAllProvidersMode(
	value: CodexConversionConfig["scope"]["allProviders"],
): string {
	if (value === "on") return "all providers";
	return "Codex and configured";
}

function parseAllProvidersMode(
	value: string,
): CodexConversionConfig["scope"]["allProviders"] {
	if (value === "all providers") return "on";
	return "off";
}

function normalizeCodexProviderText(value: string): string {
	return normalizeProviderList(value.split(",")).join(", ");
}
