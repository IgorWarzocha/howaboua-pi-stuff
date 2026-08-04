import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { type ConfigSetting, toggle } from "./config-items-shared.ts";

export function buildDisplaySettings(
	config: CodexConversionConfig,
): ConfigSetting[] {
	return [
		toggle(
			"statusLine",
			"Statusline",
			config.ui.statusLine,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, statusLine: enabled },
			}),
		),
		toggle(
			"toolRenaming",
			"Tool naming",
			config.ui.toolRenaming,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, toolRenaming: enabled },
			}),
		),
		toggle(
			"compactTools",
			"Compact tool output",
			config.ui.compactTools,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, compactTools: enabled },
			}),
		),
		toggle(
			"codeModeDetails",
			"Code Mode details",
			config.ui.codeModeDetails,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, codeModeDetails: enabled },
			}),
		),
		toggle(
			"backgroundShellWidget",
			"Background shells widget",
			config.ui.backgroundShellWidget,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, backgroundShellWidget: enabled },
			}),
		),
	];
}
