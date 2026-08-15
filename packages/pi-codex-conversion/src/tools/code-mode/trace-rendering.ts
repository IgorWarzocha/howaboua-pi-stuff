import {
	type Component,
	Container,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import { previewText, renderTextAndImages } from "./render-content.js";
import type {
	CodeModeRenderContext,
	CodeModeRenderTheme,
	CodeModeToolDefinition,
	ProgrammaticCodeModeToolDefinition,
	RuntimeToolTrace,
} from "./types.js";

export function renderTraceAndOutput(
	traces: RuntimeToolTrace[],
	droppedTraceCount: number,
	tools: CodeModeToolDefinition[],
	output: Component,
	hasOutput: boolean,
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	emittedImages: Map<string, Set<string>>,
): Component {
	if (traces.length === 0 && droppedTraceCount === 0) return output;
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const container = new Container();
	if (droppedTraceCount > 0) {
		container.addChild(
			new Text(
				theme.fg("muted", `… ${droppedTraceCount} earlier nested call${droppedTraceCount === 1 ? "" : "s"} omitted`),
				0,
				0,
			),
		);
	}
	for (const trace of traces) {
		const rendered = renderTrace(trace, byName.get(trace.name), options, theme, context, emittedImages);
		for (const component of rendered) container.addChild(component);
	}
	if (hasOutput) {
		container.addChild(new Spacer(1));
		container.addChild(output);
	}
	return container;
}

function renderTrace(
	trace: RuntimeToolTrace,
	tool: CodeModeToolDefinition | undefined,
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	emittedImages: Map<string, Set<string>>,
): Component[] {
	const renderedTrace = withoutEmittedImages(trace, emittedImages);
	const renderContext = {
		toolCallId: trace.id,
		cwd: context?.cwd,
		expanded: options.expanded,
		isError: trace.status === "error",
		args: trace.input,
		invalidate: context?.invalidate,
	};
	const programmatic = isProgrammaticTool(tool) ? tool : undefined;
	let call: Component;
	try {
		call = programmatic?.renderCall
			? programmatic.renderCall(trace.input, theme, renderContext)
			: renderGenericTraceCall(trace, theme, options.expanded);
	} catch {
		call = renderGenericTraceCall(trace, theme, options.expanded);
	}
	const components = [call];
	if (renderedTrace.result && programmatic?.renderResult) {
		try {
			components.push(programmatic.renderResult(
				renderedTrace.result,
				{ expanded: options.expanded, isPartial: trace.status === "running" },
				theme,
				renderContext,
			));
		} catch {
			// A stale persisted trace must not break the whole transcript.
		}
	}
	if (trace.status === "error" && trace.error) {
		components.push(new Text(theme.fg("error", trace.error), 4, 0));
	} else if (renderedTrace.result && !programmatic?.renderResult) {
		components.push(renderGenericTraceResult(renderedTrace, theme, options.expanded || options.isPartial));
	}
	return components;
}

function withoutEmittedImages(
	trace: RuntimeToolTrace,
	emittedImages: Map<string, Set<string>>,
): RuntimeToolTrace {
	if (!trace.result) return trace;
	const content = trace.result.content.filter(
		(item) => item.type !== "image" || !emittedImages.get(item.mimeType)?.has(item.data),
	);
	if (content.length === trace.result.content.length) return trace;
	return { ...trace, result: { ...trace.result, content } };
}

function renderGenericTraceCall(
	trace: RuntimeToolTrace,
	theme: CodeModeRenderTheme,
	expanded: boolean,
): Text {
	const verb = trace.status === "running" ? "Running" : trace.status === "error" ? "Failed" : "Ran";
	let text = `${theme.fg("dim", "•")} ${theme.bold(`${verb} ${trace.name}`)}`;
	if (expanded) {
		const input = typeof trace.input === "string" ? trace.input : safeRenderString(trace.input);
		if (input) text += `\n${theme.fg("dim", input)}`;
	}
	return new Text(text, 0, 0);
}

function renderGenericTraceResult(
	trace: RuntimeToolTrace,
	theme: CodeModeRenderTheme,
	full: boolean,
): Component {
	const result = trace.result;
	if (!result) return new Container();
	const text = result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	const images = result.content.filter(
		(item): item is typeof item & { data: string; mimeType: string } =>
			item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string",
	);
	const renderedText = theme.fg("dim", text);
	return renderTextAndImages(full ? renderedText : previewText(renderedText, theme), images, theme);
}

function isProgrammaticTool(
	tool: CodeModeToolDefinition | undefined,
): tool is ProgrammaticCodeModeToolDefinition {
	return Boolean(tool && "invoke" in tool);
}

function safeRenderString(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value ?? "");
	} catch {
		return "[unavailable input]";
	}
}
