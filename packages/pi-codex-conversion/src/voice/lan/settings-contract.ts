import type { CodexConversionConfig } from "../../adapter/activation/config.ts";

// Shared with the natively imported HTTP server; keep Pi loader imports out.
export class LanVoiceSettingsError extends Error {}

export interface LanVoiceSettings {
	getConfig(): CodexConversionConfig;
	settings(): unknown;
	configureSettings(body: Record<string, unknown>): unknown;
}
