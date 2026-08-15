import {
	type Component,
	Container,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import {
	imagesByMimeType,
	previewText,
	renderTextAndImages,
	type RenderedToolContent,
} from "./render-content.js";
import type { CodeModeRenderTracker } from "./render-tracker.js";
import { formatNotebookMemory } from "./tool-result.js";
import { renderTraceAndOutput } from "./trace-rendering.js";
import type {
	CodeModeRenderContext,
	CodeModeRenderTheme,
	CodeModeToolDefinition,
	NotebookMemoryUsage,
	RuntimeToolTrace,
} from "./types.js";

interface CodeModeResultDetails {
	cellId?: string | undefined;
	status?: "running" | "yielded" | "terminated" | "result" | undefined;
	notification?: boolean | undefined;
	traces?: RuntimeToolTrace[] | undefined;
	droppedTraceCount?: number | undefined;
	scriptError?: string | undefined;
	notebookMemory?: NotebookMemoryUsage | undefined;
}

export function renderTrackedCodeModeResult(
	result: { content: RenderedToolContent[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	tracker: CodeModeRenderTracker,
	tools: CodeModeToolDefinition[] = [],
	richRendering = true,
): Component {
	if (!options.isPartial && context?.toolCallId) {
		const details = asDetails(result.details);
		tracker.finish(context.toolCallId, details.status === "yielded" ? "yielded" : "done");
	}
	return renderCodeModeResult(result, options, theme, context, tools, richRendering);
}

function renderCodeModeResult(
	result: { content: RenderedToolContent[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	tools: CodeModeToolDefinition[],
	richRendering: boolean,
): Component {
	const details = asDetails(result.details);
	const content = details.notification || details.status === undefined ? result.content : result.content.slice(1);
	const notebookMemoryText = details.notebookMemory ? formatNotebookMemory(details.notebookMemory) : undefined;
	const renderedContent = notebookMemoryText
		&& content[0]?.type === "text"
		&& content[0].text === notebookMemoryText
		? content.slice(1)
		: content;
	const text = renderedContent
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
	const scriptErrorRenderedByTrace = Boolean(
		details.scriptError
		&& details.traces?.some((trace) => trace.status === "error" && trace.error === details.scriptError),
	);
	const status = scriptErrorRenderedByTrace ? "" : statusText(details);
	const outputText = [text, status].filter(Boolean).join("\n");
	const tone = context?.isError ? "error" : details.status === "yielded" ? "accent" : "dim";
	const renderedText = outputText ? theme.fg(tone, outputText) : "";
	const images = renderedContent.filter(
		(item): item is RenderedToolContent & { data: string; mimeType: string } =>
			item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string",
	);
	const emittedImages = imagesByMimeType(images);
	const showOutput = richRendering
		|| Boolean(details.scriptError && !scriptErrorRenderedByTrace)
		|| details.notification === true
		|| images.length > 0;
	const output = showOutput && (options.expanded || options.isPartial)
		? renderTextAndImages(renderedText, [], theme)
		: showOutput
			? renderTextAndImages(previewText(renderedText, theme), [], theme)
			: new Container();
	const body = renderTraceAndOutput(
		details.traces ?? [],
		details.droppedTraceCount ?? 0,
		tools,
		output,
		showOutput && Boolean(renderedText),
		options,
		theme,
		context,
		emittedImages,
	);
	if (!details.notebookMemory || !notebookMemoryText) return body;
	const container = new Container();
	const ratio = details.notebookMemory.heapLimitBytes > 0
		? details.notebookMemory.heapUsedBytes / details.notebookMemory.heapLimitBytes
		: 0;
	container.addChild(
		new Text(
			theme.fg(ratio >= 0.9 ? "error" : ratio >= 0.8 ? "accent" : "muted", notebookMemoryText),
			0,
			0,
		),
	);
	if (details.traces?.length || details.droppedTraceCount || renderedText || images.length) {
		container.addChild(new Spacer(1));
		container.addChild(body);
	}
	return container;
}

function asDetails(value: unknown): CodeModeResultDetails {
	return value && typeof value === "object" ? value as CodeModeResultDetails : {};
}

function statusText(details: CodeModeResultDetails): string {
	if (details.scriptError) return `Script error: ${details.scriptError}`;
	if (details.status === "yielded" && details.cellId) return `Cell #${details.cellId} still running`;
	if (details.status === "terminated") return details.cellId ? `Cell #${details.cellId} terminated` : "Cell terminated";
	return "";
}
