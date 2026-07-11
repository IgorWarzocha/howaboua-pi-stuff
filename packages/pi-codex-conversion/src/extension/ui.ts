import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT } from "../adapter/compaction/types.ts";
import { BACKGROUND_BASH_WIDGET_ID, registerBackgroundBashWidgetShortcuts, renderBackgroundBashWidget } from "../ui/background-bash-widget.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";

export interface CodexUiController {
	clearBackgroundWidget(): void;
	renderBackgroundWidget(): void;
	applyConfig(config: CodexConversionConfig): void;
}

export function registerCodexUi(pi: ExtensionAPI, runtime: CodexExtensionRuntime): CodexUiController {
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	const clearBackgroundWidget = () => {
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = undefined;
		runtime.backgroundWidget.ctx?.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
	};
	const renderBackgroundWidget = () => {
		const ctx = runtime.backgroundWidget.ctx;
		if (!ctx) return;
		if (!runtime.state.config.ui.backgroundShellWidget) {
			clearBackgroundWidget();
			return;
		}
		renderBackgroundBashWidget(ctx, runtime.backgroundWidget, runtime.sessions);
	};

	registerBackgroundBashWidgetShortcuts(pi, runtime.backgroundWidget, runtime.sessions, runtime.state.config.ui, () => runtime.state.config.ui.backgroundShellWidget);
	pi.registerMessageRenderer(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, (message, _options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("[compaction]")), 0, 0));
		const content = typeof message.content === "string" ? message.content : NATIVE_COMPACTION_DISPLAY_TEXT;
		box.addChild(new Text(`\n${theme.fg("customMessageText", content)}`, 0, 0));
		const render = box.render.bind(box);
		box.render = (width) => render(width).map((line) => truncateToWidth(line, width, ""));
		return box;
	});
	runtime.sessions.onSessionChange((reason) => {
		if (!runtime.backgroundWidget.ctx || !runtime.state.config.ui.backgroundShellWidget) return;
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

	return {
		clearBackgroundWidget,
		renderBackgroundWidget,
		applyConfig(config) {
			if (!config.ui.backgroundShellWidget) clearBackgroundWidget();
			else renderBackgroundWidget();
		},
	};
}
