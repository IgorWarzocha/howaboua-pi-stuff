import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT, type NativeCompactionDisplayEntry } from "../adapter/compaction/types.ts";
import { BACKGROUND_BASH_WIDGET_ID, registerBackgroundBashWidgetShortcuts, renderBackgroundBashWidget } from "../ui/background-bash-widget.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import { renderCodexStatus } from "../ui/status.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import { fetchCodexWeeklyUsageLeft } from "../codex-usage/client.ts";

export interface CodexUiController {
	clearBackgroundWidget(): void;
	renderBackgroundWidget(): void;
	invalidateUsageStatus(): void;
	applyConfig(config: CodexConversionConfig, ctx: ExtensionContext, previousConfig: CodexConversionConfig): void;
	refreshUsageStatus(ctx: ExtensionContext): Promise<void>;
}

export function registerCodexUi(pi: ExtensionAPI, runtime: CodexExtensionRuntime): CodexUiController {
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	let usageGeneration = 0;
	const clearBackgroundWidget = () => {
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = undefined;
		runtime.backgroundWidget.ctx?.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
	};
	const renderBackgroundWidget = () => {
		const ctx = runtime.backgroundWidget.ctx;
		if (!ctx) return;
		if (runtime.state.config.voiceFeaturesOnly || !runtime.state.config.ui.backgroundShellWidget) {
			clearBackgroundWidget();
			return;
		}
		renderBackgroundBashWidget(ctx, runtime.backgroundWidget, runtime.sessions);
	};

	registerBackgroundBashWidgetShortcuts(pi, runtime.backgroundWidget, runtime.sessions, runtime.state.config.ui, () => !runtime.state.config.voiceFeaturesOnly && runtime.state.config.ui.backgroundShellWidget);
	const renderNativeCompaction = (
		content: string,
		kind: NativeCompactionDisplayEntry["kind"],
		theme: Parameters<Parameters<ExtensionAPI["registerEntryRenderer"]>[1]>[2],
	) => {
		if (kind === "usage") return new Text(theme.fg("dim", `  ${content}`), 0, 0);
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("[compaction]")), 0, 0));
		box.addChild(new Text(`\n${theme.fg("customMessageText", content)}`, 0, 0));
		const render = box.render.bind(box);
		box.render = (width) => render(width).map((line) => truncateToWidth(line, width, ""));
		return box;
	};
	// Legacy sessions stored display-only compaction records as custom messages.
	pi.registerMessageRenderer<{ kind?: "usage" | undefined }>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : NATIVE_COMPACTION_DISPLAY_TEXT;
		return renderNativeCompaction(content, message.details?.kind, theme);
	});
	pi.registerEntryRenderer<NativeCompactionDisplayEntry>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, (entry, _options, theme) => {
		return renderNativeCompaction(
			typeof entry.data?.content === "string" ? entry.data.content : NATIVE_COMPACTION_DISPLAY_TEXT,
			entry.data?.kind,
			theme,
		);
	});
	runtime.sessions.onSessionChange((reason) => {
		if (!runtime.backgroundWidget.ctx || runtime.state.config.voiceFeaturesOnly || !runtime.state.config.ui.backgroundShellWidget) return;
		if (reason === "output") {
			if (renderTimer) return;
			renderTimer = setTimeout(() => {
				renderTimer = undefined;
				renderBackgroundWidget();
			}, 250);
			return;
		}
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = undefined;
		renderBackgroundWidget();
	});
	const invalidateUsageStatus = () => {
		usageGeneration += 1;
		runtime.state.weeklyUsageLeft = undefined;
	};
	const refreshUsageStatus = async (ctx: ExtensionContext) => {
		const generation = ++usageGeneration;
		if (!ctx.hasUI || runtime.state.config.voiceFeaturesOnly || !runtime.state.config.ui.statusLine) {
			runtime.state.weeklyUsageLeft = undefined;
			return;
		}
		if (!isAdapterRuntime(resolveCodexRuntimePlan(ctx, runtime.state.config))) return;
		const weeklyUsageLeft = await fetchCodexWeeklyUsageLeft(ctx);
		const plan = resolveCodexRuntimePlan(ctx, runtime.state.config);
		if (
			generation !== usageGeneration ||
			!ctx.hasUI ||
			runtime.state.config.voiceFeaturesOnly ||
			!runtime.state.config.ui.statusLine ||
			!isAdapterRuntime(plan)
		) return;
		runtime.state.weeklyUsageLeft = weeklyUsageLeft;
		renderCodexStatus(ctx, runtime.state, plan);
	};

	return {
		clearBackgroundWidget,
		renderBackgroundWidget,
		invalidateUsageStatus,
		refreshUsageStatus,
		applyConfig(config, ctx, previousConfig) {
			if (config.voiceFeaturesOnly || !config.ui.statusLine) {
				invalidateUsageStatus();
			} else if (
				previousConfig.voiceFeaturesOnly ||
				!previousConfig.ui.statusLine
			) {
				void refreshUsageStatus(ctx);
			}
			if (config.voiceFeaturesOnly || !config.ui.backgroundShellWidget) clearBackgroundWidget();
			else renderBackgroundWidget();
		},
	};
}
