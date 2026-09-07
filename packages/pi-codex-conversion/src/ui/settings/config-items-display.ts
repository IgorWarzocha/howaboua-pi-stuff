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
			"Rename tool calls to user-friendly names.",
		),
		toggle(
			"compactTools",
			"Compact tool output",
			config.ui.compactTools,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, compactTools: enabled },
			}),
			"Hide patch diffs in collapsed tool results. Expand a result to inspect the changes.",
		),
		toggle(
			"codeModeDetails",
			"Code / Notebook details",
			config.ui.codeModeDetails,
			(enabled, current) => ({
				...current,
				ui: { ...current.ui, codeModeDetails: enabled },
			}),
			"Show Code and Notebook source previews and execution output alongside nested tool results.",
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
