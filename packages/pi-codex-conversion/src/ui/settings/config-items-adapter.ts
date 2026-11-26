import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { editorCommand } from "./config-editor.ts";
import {
	getModelScopeOverride,
	withModelScopeOverride,
} from "../../adapter/activation/model-scope.ts";
import { type ConfigSetting, setting } from "./config-items-shared.ts";

export function buildAdapterSettings(
	config: CodexConversionConfig,
	model: ExtensionContext["model"],
): ConfigSetting[] {
	return [
		setting(
			{
				id: "modelScope",
				description: "Choose which models use the Codex adapter.",
				label: "Model scope",
				currentValue: MODEL_SCOPE_LABELS[config.scope.mode],
				values: Object.values(MODEL_SCOPE_LABELS),
			},
			(value, current) => ({
				...current,
				scope: {
					...current.scope,
					mode:
						value === MODEL_SCOPE_LABELS.all
							? "all"
							: value === MODEL_SCOPE_LABELS.selected
								? "selected"
								: "automatic",
				},
			}),
		),
		...(model ? [currentModelSetting(config, model)] : []),
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

export const MODEL_SCOPE_LABELS = {
	automatic: "Automatic",
	all: "All providers",
	selected: "Selected models",
} as const;

function currentModelSetting(
	config: CodexConversionConfig,
	{ provider, id }: NonNullable<ExtensionContext["model"]>,
): ConfigSetting {
	const model = { provider, id };
	const override = getModelScopeOverride(config.scope.modelOverrides, model);
	return setting(
		{
			id: "currentModelScope",
			label: "Current model",
			description: `Override model scope for ${provider}/${id}. Default follows model scope.`,
			currentValue:
				override === true ? "On" : override === false ? "Off" : "Default",
			values: ["Default", "On", "Off"],
		},
		(value, current) => ({
			...current,
			scope: {
				...current.scope,
				modelOverrides: withModelScopeOverride(
					current.scope.modelOverrides,
					model,
					value === "Default" ? null : value === "On",
				),
			},
		}),
	);
}
