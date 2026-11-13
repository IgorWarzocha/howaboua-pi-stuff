import {
	type Component,
	Container,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import { type EmittedImageCounts, previewText, renderTextAndImages } from "./render-content.js";
import {
	CodeModeNestedRenderStore,
	type NestedRenderState,
} from "./trace-render-state.js";
import type {
	CodeModeRenderContext,
	CodeModeNestedRenderContext,
	CodeModeRenderTheme,
	CodeModeToolDefinition,
	ProgrammaticCodeModeToolDefinition,
	RuntimeToolTrace,
} from "./types.js";

export { CodeModeNestedRenderStore } from "./trace-render-state.js";

export function renderTraceAndOutput(
	traces: RuntimeToolTrace[],
	droppedTraceCount: number,
	tools: CodeModeToolDefinition[],
	output: Component,
	hasOutput: boolean,
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	emittedImages: EmittedImageCounts,
	renderStore: CodeModeNestedRenderStore,
	traceStates: Map<string, NestedRenderState>,
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
		const rendered = renderTrace(
			trace,
			byName.get(trace.name),
			options,
			theme,
			context,
			emittedImages,
			renderStore,
			traceStates,
		);
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
	emittedImages: EmittedImageCounts,
	renderStore: CodeModeNestedRenderStore,
	traceStates: Map<string, NestedRenderState>,
): Component[] {
	const programmatic = isProgrammaticTool(tool) ? tool : undefined;
	const captured = renderStore.get(trace.id);
	const renderState = traceStates.get(trace.id) ?? { state: {} };
	traceStates.set(trace.id, renderState);
	const renderedTrace = withoutEmittedImages(
		captured.result ? { ...trace, result: captured.result } : trace,
		emittedImages,
	);
	const rendererInput = captured.input ?? trace.input;
	const rendererResult = renderedTrace.result;
	const partial = trace.status === "running" || trace.status === "blocked";
	const renderContext: CodeModeNestedRenderContext = {
		...(context?.keyHint ? { keyHint: context.keyHint } : {}),
		...(context?.keyText ? { keyText: context.keyText } : {}),
		toolCallId: trace.id,
		cwd: context?.cwd ?? "",
		state: renderState.state,
		executionStarted: true,
		argsComplete: true,
		isPartial: partial,
		expanded: options.expanded,
		showImages: context?.showImages ?? true,
		isError: trace.status === "error",
		isBlocked: trace.status === "blocked",
		args: rendererInput,
		invalidate: context?.invalidate ?? (() => undefined),
	};
	let call: Component;
	try {
		call = programmatic?.renderCall
			? programmatic.renderCall(rendererInput, theme, {
					...renderContext,
					lastComponent: renderState.callComponent,
				})
			: renderGenericTraceCall(trace, theme, options.expanded);
		if (programmatic?.renderCall) renderState.callComponent = call;
	} catch {
		if (programmatic?.renderCall) renderState.callComponent = undefined;
		call = renderGenericTraceCall(trace, theme, options.expanded);
	}
	const components = [call];
	let customResultRendered = false;
	if (rendererResult && programmatic?.renderResult) {
		try {
			const resultComponent = programmatic.renderResult(
				rendererResult,
				{ expanded: options.expanded, isPartial: partial },
				theme,
				{
					...renderContext,
					// Like Pi's native row, this wrapper owns result-content images.
					showImages: rendererResult.content.some((item) => item.type === "image") ? false : renderContext.showImages,
					lastComponent: renderState.resultComponent,
				},
			);
			renderState.resultComponent = resultComponent;
			components.push(resultComponent);
			customResultRendered = true;
		} catch {
			renderState.resultComponent = undefined;
			// An extension renderer must not break the whole transcript.
		}
	}
	if (trace.status === "error" && trace.error) {
		if (!customResultRendered)
			components.push(new Text(theme.fg("error", trace.error), 4, 0));
	} else if (renderedTrace.result && !customResultRendered) {
		components.push(renderGenericTraceResult(renderedTrace, theme, options.expanded || options.isPartial, context, renderState));
	}
	if (customResultRendered && rendererResult && context?.showImages !== false) {
		const images = rendererResult.content.filter((item) => item.type === "image");
		if (images.length) components.push(renderTextAndImages("", images, theme, renderState.images ??= []));
	}
	return components;
}

function withoutEmittedImages(
	trace: RuntimeToolTrace,
	emittedImages: EmittedImageCounts,
): RuntimeToolTrace {
	if (!trace.result || emittedImages.size === 0) return trace;
	const content = trace.result.content.filter((item) => {
		if (item.type !== "image") return true;
		const counts = emittedImages.get(item.mimeType);
		const count = counts?.get(item.data) ?? 0;
		if (!counts || count === 0) return true;
		counts.set(item.data, count - 1);
		return false;
	});
	if (content.length === trace.result.content.length) return trace;
	return { ...trace, result: { ...trace.result, content } };
}

function renderGenericTraceCall(
	trace: RuntimeToolTrace,
	theme: CodeModeRenderTheme,
	expanded: boolean,
): Text {
	const verb = trace.status === "running" ? "Running" : trace.status === "blocked" ? "Blocked" : trace.status === "error" ? "Failed" : "Ran";
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
	context: CodeModeRenderContext | undefined,
	renderState: NestedRenderState,
): Component {
	const result = trace.result;
	if (!result) return new Container();
	const text = result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	const images = context?.showImages === false ? [] : result.content.filter(
		(item): item is typeof item & { data: string; mimeType: string } =>
			item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string",
	);
	const renderedText = theme.fg("dim", text);
	return renderTextAndImages(full ? renderedText : previewText(renderedText, theme, false, context), images, theme, renderState.images ??= []);
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
