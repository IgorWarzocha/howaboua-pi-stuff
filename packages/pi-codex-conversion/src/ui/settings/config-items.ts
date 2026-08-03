import type { Theme } from "@earendil-works/pi-coding-agent";
import type {
	CodexConversionConfig,
	VoiceContextModel,
} from "../../adapter/activation/config.ts";
import { buildAdapterSettings } from "./config-items-adapter.ts";
import { buildDisplaySettings } from "./config-items-display.ts";
import { buildOpenAISettings } from "./config-items-openai.ts";
import type { ConfigSetting } from "./config-items-shared.ts";
import { buildToolsSettings } from "./config-items-tools.ts";
import { buildVoiceSettings } from "./config-items-voice.ts";
import type { SettingsTab } from "./tabs.ts";

export type { ConfigSetting } from "./config-items-shared.ts";

export function buildConfigSettings(
	tab: SettingsTab,
	config: CodexConversionConfig,
	theme: Theme,
	availableContextModels: VoiceContextModel[] = [],
): ConfigSetting[] {
	if (tab === "adapter") return buildAdapterSettings(config, theme);
	if (tab === "tools") return buildToolsSettings(config, theme);
	if (tab === "openai") return buildOpenAISettings(config, theme);
	if (tab === "display") return buildDisplaySettings(config);
	if (tab === "voice")
		return buildVoiceSettings(config, availableContextModels);
	return [];
}
