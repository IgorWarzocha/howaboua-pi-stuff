import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type SettingsTab = "notes" | "board";
export type OpenSettings = (
	ctx: ExtensionCommandContext,
	tab: SettingsTab,
) => Promise<void>;

export interface FeatureSettings {
	openSettings(ctx: ExtensionCommandContext): Promise<SettingsTab | undefined>;
}
