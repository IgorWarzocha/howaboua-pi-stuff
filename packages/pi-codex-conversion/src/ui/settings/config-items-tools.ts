import type { Theme } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { getCodexConversionConfigPath } from "../../adapter/activation/config-store.ts";
import { type ConfigSetting, setting, toggle } from "./config-items-shared.ts";

export function buildToolsSettings(
	config: CodexConversionConfig,
	theme: Theme,
	configPath: string = getCodexConversionConfigPath(),
): ConfigSetting[] {
	return [
		toggle(
			"viewImageFallback",
			"Text Image Descriptions",
			config.tools.viewImageFallback,
			(enabled, current) => ({
				...current,
				tools: { ...current.tools, viewImageFallback: enabled },
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
			label: theme.fg("dim", configPath),
			currentValue: "",
		}),
	];
}
