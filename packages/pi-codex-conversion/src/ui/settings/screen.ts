import { type ExtensionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { CodexConversionConfig, LunaCacheKeepaliveMinutes, LunaCacheKeepaliveIntervalMinutes, CacheKeepaliveIntervalMinutes } from "../../adapter/activation/config.ts";
import type { CodexConversionConfigScope } from "../../adapter/activation/config-store.ts";
import type { CodexLanVoiceServerStatus } from "../../voice/lan/controller.ts";
import { handleAboutTabInput } from "./about-tab.ts";
import { SETTINGS_TABS, type SettingsTab } from "./tabs.ts";
import { createUsageTab, type UsageTabOptions } from "./usage-tab.ts";
import { createSettingsConfiguration } from "./screen/configuration.ts";
import { renderSettingsScreen } from "./screen/view.ts";

export interface CodexSettingsScreenOptions extends UsageTabOptions {
	setModel: ExtensionAPI["setModel"];
	waitForIdle: () => Promise<void>;
	initialConfig: CodexConversionConfig;
	onChange: (nextConfig: CodexConversionConfig) => boolean;
	onGlobalNotebookJournals: (retention: CodexConversionConfig["notebook"]["journals"]) => CodexConversionConfig | undefined;
	onGlobalNotebookCheckpointCleanup: (retention: CodexConversionConfig["notebook"]["checkpointCleanup"]) => CodexConversionConfig | undefined;
	onGlobalLunaCacheKeepalive: (minutes: LunaCacheKeepaliveMinutes, interval: LunaCacheKeepaliveIntervalMinutes) => CodexConversionConfig | undefined;
	onProjectCacheKeepalive: (enabled: boolean, interval: CacheKeepaliveIntervalMinutes) => CodexConversionConfig | undefined;
	initialTab?: SettingsTab | undefined;
	configScope: {
		current: () => CodexConversionConfigScope;
		canUseFolder: boolean;
		path: () => string;
		reload: () => CodexConversionConfig;
		set: (scope: CodexConversionConfigScope) => CodexConversionConfig | undefined;
	};
	lanVoiceServer?:
		| {
				status: () => CodexLanVoiceServerStatus;
				setEnabled: (enabled: boolean) => Promise<CodexLanVoiceServerStatus>;
		  }
		| undefined;
}

export async function openCodexSettingsScreen(
	ctx: ExtensionContext,
	options: CodexSettingsScreenOptions,
): Promise<void> {
	const availableContextModels = ctx.modelRegistry
		.getAvailable()
		.filter((model) => model.input.includes("text"))
		.map((model) => ({ provider: model.provider, modelId: model.id }));

	const usageAbort = new AbortController();
	const usageSignal = ctx.signal ? AbortSignal.any([ctx.signal, usageAbort.signal]) : usageAbort.signal;
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const usageTab = createUsageTab(ctx, options, () => tui.requestRender(), usageSignal);
		const settings = createSettingsConfiguration(ctx, options, tui, theme, done, availableContextModels);
		const activateTab = (tab: SettingsTab) => {
			settings.activateTab(tab);
			if (tab === "usage") usageTab.ensureLoaded();
			tui.requestRender();
		};
		if (settings.activeTab === "usage") usageTab.ensureLoaded();

		return {
			render: (width: number) => renderSettingsScreen(width, theme, options, settings, usageTab),
			invalidate: () => settings.list.invalidate(),
			handleInput: (data: string) => {
				if (settings.pickerOpen) {
					settings.list.handleInput(data);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.shift(Key.tab))) {
					const currentIndex = SETTINGS_TABS.findIndex(
						({ id }) => id === settings.activeTab,
					);
					activateTab(
						SETTINGS_TABS[
							(currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
						]?.id ?? "adapter",
					);
					return;
				}
				if (matchesKey(data, Key.tab)) {
					const currentIndex = SETTINGS_TABS.findIndex(
						({ id }) => id === settings.activeTab,
					);
					activateTab(
						SETTINGS_TABS[(currentIndex + 1) % SETTINGS_TABS.length]?.id ??
							"adapter",
					);
					return;
				}
				if (settings.activeTab === "about" && handleAboutTabInput(data, ctx)) return;
				if (settings.activeTab === "usage" && usageTab.handleInput(data)) return;
				settings.list.handleInput?.(data);
				tui.requestRender();
			},
		};
	}).finally(() => usageAbort.abort());
}
