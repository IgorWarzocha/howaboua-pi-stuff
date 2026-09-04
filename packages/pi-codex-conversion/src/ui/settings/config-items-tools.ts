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
		),
		toggle(
			"viewImageFallback",
			"Image descriptions fallback",
			config.tools.viewImageFallback,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageFallback: enabled },
			}),
		),
		toggle(
			"applyPatchOnly",
			"Standalone apply_patch",
			config.tools.applyPatchOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, applyPatchOnly: enabled },
			}),
		),
		toggle(
			"viewImageOnly",
			"Standalone view_image",
			config.tools.viewImageOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageOnly: enabled },
			}),
		),
	];
}
