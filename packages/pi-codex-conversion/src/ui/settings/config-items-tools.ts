import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type CodexConversionConfig,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	normalizeWebSearchModel,
	WEB_SEARCH_MODELS,
} from "../../adapter/activation/config.ts";
import { getCodexConversionConfigPath } from "../../adapter/activation/config-store.ts";
import { type ConfigSetting, setting, toggle } from "./config-items-shared.ts";

export function buildToolsSettings(
	config: CodexConversionConfig,
	theme: Theme,
): ConfigSetting[] {
	return [
		toggle(
			"codeMode",
			"GPT-5.6 Code Mode",
			config.beta.codeMode,
			(enabled, current) => ({
				...current,
				beta: { ...current.beta, codeMode: enabled },
			}),
		),
		toggle(
			"viewImageFallback",
			"Text Image Descriptions",
			config.tools.viewImageFallback,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageFallback: enabled },
			}),
		),
		toggle("webRun", "Web search", config.tools.webRun, (enabled, current) => ({
			...current,
			tools: { ...current.tools, webRun: enabled },
		})),
		setting(
			{
				id: "webSearchModel",
				label: "Web search model",
				currentValue: config.openai.webSearchModel,
				values: [...WEB_SEARCH_MODELS],
			},
			(value, current) => ({
				...current,
				openai: {
					...current.openai,
					webSearchModel:
						normalizeWebSearchModel(value) ??
						DEFAULT_CODEX_CONVERSION_CONFIG.openai.webSearchModel,
				},
			}),
		),
		toggle(
			"imageGeneration",
			"Image generation",
			config.tools.imageGeneration,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, imageGeneration: enabled },
			}),
		),
		setting({
			id: "activateOnlyHeader",
			label: theme.fg("dim", "Activate Only"),
			currentValue: "",
		}),
		toggle(
			"applyPatchOnly",
			"apply_patch",
			config.tools.applyPatchOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, applyPatchOnly: enabled },
			}),
		),
		toggle(
			"viewImageOnly",
			"view_image",
			config.tools.viewImageOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageOnly: enabled },
			}),
		),
		toggle(
			"webRunOnly",
			"web_run",
			config.tools.webRunOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, webRunOnly: enabled },
			}),
		),
		toggle(
			"imageGenerationOnly",
			"imagegen",
			config.tools.imageGenerationOnly,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, imageGenerationOnly: enabled },
			}),
		),
		setting({
			id: "customRustBinariesHelp",
			label: theme.fg(
				"dim",
				"For compatibility with custom Rust binaries, edit:",
			),
			currentValue: "",
		}),
		setting({
			id: "customRustBinariesPath",
			label: theme.fg("dim", getCodexConversionConfigPath()),
			currentValue: "",
		}),
	];
}
