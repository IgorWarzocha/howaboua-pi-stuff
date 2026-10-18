import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { type ConfigSetting, toggle } from "./config-items-shared.ts";

export function buildToolsSettings(
	config: CodexConversionConfig,
): ConfigSetting[] {
	return [
		{
			item: {
				id: "notebookJournals", label: "Notebook journals",
				currentValue: config.notebook.journals === "off" ? "Off & remove" : config.notebook.journals === "on" ? "On" : "Keep for 1 week",
				values: ["Off & remove", "Keep for 1 week", "On"],
				description: "Applies to all projects. Off stops recording and removes journals. One week expires journals after 7 days without updates. On keeps normal per-session size limits. Saved variables and conversations are unaffected.",
			},
			action: "global-notebook-journals",
		},
		{
			item: {
				id: "notebookCheckpointCleanup", label: "Cleanup session checkpoints",
				currentValue: config.notebook.checkpointCleanup === "month" ? "1 month" : config.notebook.checkpointCleanup === "week" ? "1 week" : "Never",
				values: ["Never", "1 month", "1 week"],
				description: "Applies to all projects. Remove checkpoints after 30 or 7 days without session use, checked daily. Running sessions, shared bindings, notes and conversations are preserved.",
			},
			action: "global-notebook-checkpoint-cleanup",
		},
		toggle(
			"autoReasoning",
			"Auto reasoning",
			config.tools.autoReasoning,
			(enabled, current) => ({ ...current, tools: { ...current.tools, autoReasoning: enabled } }),
			"Let supported GPT-6 models, including GPT-6.1 Sol, adjust reasoning during a task, never below your starting level, then restore it when finished.",
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
