import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { type ConfigSetting, toggle } from "./config-items-shared.ts";

export function buildToolsSettings(
	config: CodexConversionConfig,
): ConfigSetting[] {
	return [
		toggle(
			"autoReasoning",
			"Auto reasoning (Astra only)",
			config.tools.autoReasoning,
			(enabled, current) => ({ ...current, tools: { ...current.tools, autoReasoning: enabled } }),
			"Let Astra adjust reasoning during a task, never below your starting level, then restore it when finished.",
		),
		toggle(
			"viewImageFallback",
			"Image descriptions fallback",
			config.tools.viewImageFallback,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageFallback: enabled },
			}),
			"Use a vision model to describe images for text-only models instead of rejecting image requests.",
		),
		toggle(
			"notebookPlainCommandOutput",
			"Plain command output",
			config.notebook.plainCommandOutput,
			(enabled, current) => ({
				...current,
				notebook: { ...current.notebook, plainCommandOutput: enabled },
			}),
			"In Code and Notebook modes, send shell output without JSON escaping, keeping command status and continuation details.",
		),
		toggle(
			"applyPatchOnly",
			"Standalone apply_patch",
			config.tools.applyPatchOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, applyPatchOnly: enabled },
			}),
			"Expose apply_patch without the full adapter.",
		),
		toggle(
			"viewImageOnly",
			"Standalone view_image",
			config.tools.viewImageOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageOnly: enabled },
			}),
			"Expose view_image without the full adapter. Text-only models also need Image descriptions fallback.",
		),
	];
}
