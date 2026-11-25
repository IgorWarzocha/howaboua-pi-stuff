import type { CodexConversionConfig } from "../../adapter/activation/config.ts";

export interface LanVoiceSettings {
	getConfig(): CodexConversionConfig;
	settings(): unknown;
	configureSettings(body: Record<string, unknown>): unknown;
}
