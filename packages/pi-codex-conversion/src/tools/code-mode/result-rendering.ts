import type { ToolDetailsMode } from "../../adapter/activation/config-contract.ts";
import { type Component, Container } from "@earendil-works/pi-tui";
import {
	previewText,
	renderTextAndImages,
	type RenderedToolContent,
} from "./render-content.js";
import type { CodeModeRenderTracker } from "./render-tracker.js";
import type { NestedRenderState } from "./trace-render-state.js";
import {
	type CodeModeNestedRenderStore,
	renderTraceAndOutput,
} from "./trace-rendering.js";
import type {
	CodeModeRenderContext,
	CodeModeRenderTheme,
	CodeModeToolDefinition,
	RuntimeToolTrace,
} from "./types.js";

interface CodeModeResultDetails {
	cellId?: string | undefined;
	status?: "running" | "yielded" | "terminated" | "result" | undefined;
	statusPrefix?: boolean | undefined;
	deliveryPending?: boolean | undefined;
	notification?: boolean | undefined;
	traces?: RuntimeToolTrace[] | undefined;
	droppedTraceCount?: number | undefined;
	scriptError?: string | undefined;
}

class CodeModeResult extends Container {
	// UI instances belong to this row, not the evictable capture store shared by history.
	readonly traces = new Map<string, NestedRenderState>();
}

export function renderTrackedCodeModeResult(
	result: { content: RenderedToolContent[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	tracker: CodeModeRenderTracker,
	renderStore: CodeModeNestedRenderStore,
	tools: CodeModeToolDefinition[] = [],
	mode: ToolDetailsMode = "preview",
): Component {
	const component =
		context?.lastComponent instanceof CodeModeResult
			? context.lastComponent
			: new CodeModeResult();
	const details = asDetails(result.details);
	if (!options.isPartial && context?.toolCallId) {
		tracker.finish(
			context.toolCallId,
			details.status === "yielded" ? "yielded" : "done",
		);
	}
	const retained = new Set(details.traces?.map((trace) => trace.id));
	for (const id of component.traces.keys()) {
		if (!retained.has(id)) component.traces.delete(id);
	}
	component.clear();
	component.addChild(
		renderCodeModeResult(
			result,
			options,
			theme,
			context,
			tools,
			renderStore,
			mode,
			component.traces,
		),
	);
	return component;
}

function renderCodeModeResult(
	result: { content: RenderedToolContent[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	tools: CodeModeToolDefinition[],
	renderStore: CodeModeNestedRenderStore,
	mode: ToolDetailsMode,
	traceStates: Map<string, NestedRenderState>,
): Component {
	const details = asDetails(result.details);
	// Older results always carried a leading status block. Never strip user output from new results.
	const hasStatusPrefix =
		details.statusPrefix ??
		(details.status !== undefined && !details.notification);
	const content = hasStatusPrefix ? result.content.slice(1) : result.content;
	const textBlocks = content
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "");
	const scriptErrorRenderedByTrace = Boolean(
		details.scriptError &&
		details.traces?.some(
			(trace) =>
				trace.status === "error" && trace.error === details.scriptError,
		),
	);
	const status = scriptErrorRenderedByTrace ? "" : statusText(details);
	const tone = context?.isError
		? "error"
		: details.status === "yielded"
			? "accent"
			: "dim";
	const images = content.filter(
		(item): item is RenderedToolContent & { data: string; mimeType: string } =>
			item.type === "image" &&
			typeof item.data === "string" &&
			typeof item.mimeType === "string",
	);
	const hidePreview =
		mode === "minimal" &&
		!options.expanded &&
		!context?.isError &&
		!details.scriptError &&
		!details.notification;
	const renderOutput = (visibleTraceText: ReadonlySet<string>) => {
		const text = textBlocks
			.filter((block) => !visibleTraceText.has(block))
			.join("\n");
		const outputText = [text, status].filter(Boolean).join("\n");
		if (!outputText) return undefined;
		const renderedText = theme.fg(tone, outputText);
		const displayText = hidePreview
			? [
					previewText(text ? theme.fg(tone, text) : "", theme, true, context),
					status ? theme.fg(tone, status) : "",
				]
					.filter(Boolean)
					.join("\n")
			: options.expanded || options.isPartial
				? renderedText
				: previewText(renderedText, theme, false, context);
		return renderTextAndImages(displayText, [], theme);
	};
	return renderTraceAndOutput(
		details.traces ?? [],
		details.droppedTraceCount ?? 0,
		tools,
		renderOutput,
		options,
		theme,
		context,
		images,
		renderStore,
		traceStates,
	);
}

function asDetails(value: unknown): CodeModeResultDetails {
	return value && typeof value === "object"
		? (value as CodeModeResultDetails)
		: {};
}

function statusText(details: CodeModeResultDetails): string {
	if (details.deliveryPending)
		return `Cell #${details.cellId} complete; results pending delivery`;
	if (details.scriptError) return `Script error: ${details.scriptError}`;
	if (details.status === "yielded" && details.cellId)
		return `Cell #${details.cellId} still running`;
	if (details.status === "terminated")
		return details.cellId
			? `Cell #${details.cellId} terminated`
			: "Cell terminated";
	return "";
}
