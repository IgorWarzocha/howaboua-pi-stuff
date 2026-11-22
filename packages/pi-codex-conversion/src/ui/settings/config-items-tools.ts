import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { type ConfigSetting, toggle } from "./config-items-shared.ts";

export function buildToolsSettings(
	config: CodexConversionConfig,
): ConfigSetting[] {
	return [
		toggle(
			"autoReasoning",
			"Auto reasoning",
			config.tools.autoReasoning,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, autoReasoning: enabled },
			}),
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
	];
}
