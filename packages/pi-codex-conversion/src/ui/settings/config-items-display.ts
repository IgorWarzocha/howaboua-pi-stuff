import {
	type CodexConversionConfig,
	normalizeToolDetailsMode,
} from "../../adapter/activation/config.ts";
import { type ConfigSetting, setting, toggle } from "./config-items-shared.ts";

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
			"Show the adapter mode, context settings and available Codex usage information in Pi's status area.",
		),
		toggle(
			"toolRenaming",
			"Tool naming",
			config.ui.toolRenaming,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, toolRenaming: enabled },
			}),
			"Use custom labels and output for shell commands and image viewing. Does not rename tools for the agent.",
		),
		setting(
			{
				id: "toolDetails",
				label: "Tool details",
				currentValue: config.ui.toolDetails,
				values: ["minimal", "compact", "preview"],
				description:
					"Folded view: Minimal keeps nested calls and patch summaries. Compact adds a cell output preview. Preview also shows source and patch diffs. Expand for full details in any mode.",
			},
			(value, current) => ({
				...current,
				ui: {
					...current.ui,
					toolDetails:
						normalizeToolDetailsMode(value) ?? current.ui.toolDetails,
				},
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
			"Show tracked background shell sessions and their status above the editor.",
		),
	];
}
