import { getMarkdownTheme, keyHint, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, MouseRegion, Text, TruncatedText, truncateToWidth } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { CODEX_TOOLKIT_UPDATE_TYPE, readToolkitUpdate } from "../adapter/code-mode/toolkit-updates.ts";
import { CODEX_NOTEBOOK_STATUS_TYPE, readNotebookStatus } from "../adapter/notebook-status.ts";
import { NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT, type NativeCompactionDisplayEntry } from "../adapter/compaction/types.ts";
import { fetchCodexUsageStatus } from "../codex-usage/client.ts";
import { CODEX_DEVELOPER_MESSAGE_TYPE } from "../developer-messages.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	type CodexContextManagementMessageDetails,
	isCodexContextManagementMessageDetails,
} from "../context-management/messages.ts";
import { NOTE_SAVE_MARKER, recordNoteSaveMarker } from "../context-management/note-save-marker.ts";
import { BACKGROUND_BASH_WIDGET_ID, registerBackgroundBashWidgetShortcuts, renderBackgroundBashWidget } from "../ui/background-bash-widget.ts";
import { renderCodexStatus } from "../ui/status.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";

export interface CodexUiController {
	clearBackgroundWidget(): void;
	invalidateBackgroundWidget(): void;
	renderBackgroundWidget(): void;
	invalidateUsageStatus(): void;
	applyConfig(config: CodexConversionConfig, ctx: ExtensionContext, previousConfig: CodexConversionConfig): void;
	refreshUsageStatus(ctx: ExtensionContext): Promise<void>;
	recordNoteSave(ctx: ExtensionContext): void;
}

export function registerCodexUi(pi: ExtensionAPI, runtime: CodexExtensionRuntime): CodexUiController {
	// Labels must match registered bindings, not later folder config changes.
	const backgroundShellShortcuts = { ...runtime.state.config.ui };
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	let backgroundWidgetGeneration = 0;
	let usageGeneration = 0;
	const cancelScheduledBackgroundRender = () => {
		backgroundWidgetGeneration += 1;
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = undefined;
	};
	const clearBackgroundWidget = () => {
		cancelScheduledBackgroundRender();
		runtime.backgroundWidget.ctx?.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
	};
	const invalidateBackgroundWidget = () => {
		cancelScheduledBackgroundRender();
		const ctx = runtime.backgroundWidget.ctx;
		runtime.backgroundWidget.ctx = undefined;
		ctx?.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
	};
	const renderBackgroundWidget = (generation = backgroundWidgetGeneration) => {
		if (generation !== backgroundWidgetGeneration) return;
		const ctx = runtime.backgroundWidget.ctx;
		if (!ctx) return;
		if (runtime.state.config.voiceFeaturesOnly || !runtime.state.config.ui.backgroundShellWidget) {
			clearBackgroundWidget();
			return;
		}
		renderBackgroundBashWidget(ctx, runtime.backgroundWidget, runtime.sessions, backgroundShellShortcuts);
	};

	registerBackgroundBashWidgetShortcuts(pi, runtime.backgroundWidget, runtime.sessions, backgroundShellShortcuts, () => !runtime.state.config.voiceFeaturesOnly && runtime.state.config.ui.backgroundShellWidget);
	const renderNotice = createNoticeRenderer();
	pi.registerMessageRenderer<{ title?: unknown }>(CODEX_DEVELOPER_MESSAGE_TYPE, (message, { expanded, outputPad }, theme) =>
		typeof message.content === "string" ? renderNotice(message,
			typeof message.details?.title === "string" ? message.details.title : "Context update",
			message.content, expanded, theme, outputPad) : undefined);
	// Toolkit entries already feed model context through projection. Render that
	// same stored content without sending another message or queuing a turn.
	pi.registerEntryRenderer(CODEX_TOOLKIT_UPDATE_TYPE, (entry, { expanded }, theme) => {
		const update = readToolkitUpdate(entry.data);
		const title = `${update.id === update.rootId ? "Tools" : "Tools updated"} · ${update.tools.length}`;
		return renderNotice(entry, title, update.content, expanded, theme);
	});
	pi.registerEntryRenderer(CODEX_NOTEBOOK_STATUS_TYPE, (entry, { expanded }, theme) => {
		const status = readNotebookStatus(entry.data);
		return renderNotice(entry, status.title, status.content, expanded, theme);
	});
	pi.registerEntryRenderer(NOTE_SAVE_MARKER, (_entry, { expanded }, theme) => {
		if (runtime.state.config.voiceFeaturesOnly || !runtime.state.config.ui.noteSaveMarkers) return undefined;
		return new Text(theme.fg("success", "✓ Notes saved") + (expanded
			? theme.fg("dim", "\nReturn to this reply through /tree without a summary. In Notes and history, plain /compact opens a new window without another note-writing turn.")
			: ""), 0, 0);
	});
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
	pi.registerMessageRenderer<CodexContextManagementMessageDetails>(
		CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
		(message, { expanded, outputPad }, theme) => {
			if (
				!isCodexContextManagementMessageDetails(message.details) ||
				!["window", "identity"].includes(message.details.contextManagement.kind) ||
				typeof message.content !== "string"
			)
				return undefined;
			return renderNotice(message,
				`Context window ${message.details.contextManagement.windowNumber + 1} · Notes and history`,
				message.content, expanded, theme, outputPad);
		},
	);
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
			const generation = backgroundWidgetGeneration;
			renderTimer = setTimeout(() => {
				renderTimer = undefined;
				renderBackgroundWidget(generation);
			}, 250);
			return;
		}
		cancelScheduledBackgroundRender();
		renderBackgroundWidget();
	});
	const invalidateUsageStatus = () => {
		usageGeneration += 1;
		runtime.state.usageStatus = undefined;
	};
	const recordNoteSave = (ctx: ExtensionContext) => {
		const { state } = runtime;
		if (state.config.voiceFeaturesOnly || !state.config.ui.noteSaveMarkers) return;
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		const identity = state.contextWindows.currentIdentity();
		if (plan.contextManagement && identity)
			recordNoteSaveMarker(pi, ctx, identity.currentWindowId, plan.contextManagementMode);
	};
	const refreshUsageStatus = async (ctx: ExtensionContext) => {
		const generation = ++usageGeneration;
		if (!ctx.hasUI || runtime.state.config.voiceFeaturesOnly || !runtime.state.config.ui.statusLine) {
			runtime.state.usageStatus = undefined;
			return;
		}
		if (!isAdapterRuntime(resolveCodexRuntimePlanForState(ctx, runtime.state))) return;
		const usageStatus = await fetchCodexUsageStatus(ctx);
		const plan = resolveCodexRuntimePlanForState(ctx, runtime.state);
		if (
			generation !== usageGeneration ||
			!ctx.hasUI ||
			runtime.state.config.voiceFeaturesOnly ||
			!runtime.state.config.ui.statusLine ||
			!isAdapterRuntime(plan)
		) return;
		runtime.state.usageStatus = usageStatus;
		renderCodexStatus(ctx, runtime.state, plan);
	};

	return {
		clearBackgroundWidget,
		invalidateBackgroundWidget,
		renderBackgroundWidget,
		invalidateUsageStatus,
		refreshUsageStatus,
		recordNoteSave,
		applyConfig(config, ctx, previousConfig) {
			if (config.ui.noteSaveMarkers && !previousConfig.ui.noteSaveMarkers) recordNoteSave(ctx);
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

function createNoticeRenderer() {
	// Pi recreates renderer output on invalidation. Preserve clicks until the next global toggle.
	const expansion = new WeakMap<object, { globalExpanded: boolean; expanded: boolean }>();
	return (key: object, title: string, content: string, expanded: boolean, theme: Theme, outputPad = 1) => {
		const previous = expansion.get(key);
		const state = previous && previous.globalExpanded === expanded ? previous : { globalExpanded: expanded, expanded };
		expansion.set(key, state);
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		const update = () => {
			box.clear();
			box.addChild(state.expanded
				? new Markdown(content, 0, 0, getMarkdownTheme(), { color: (text) => theme.fg("customMessageText", text) })
				: new TruncatedText(theme.fg("customMessageLabel", title.replace(/\s+/g, " ").trim())
					+ theme.fg("dim", ` (${keyHint("app.tools.expand", "to expand")})`), 0, 0));
		};
		update();
		return new MouseRegion(box, (event) => {
			if (event.type !== "click" || event.button !== "left") return undefined;
			state.expanded = !state.expanded;
			update();
			return { handled: true };
		});
	};
}
