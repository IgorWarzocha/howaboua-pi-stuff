import {
	type Component,
	Container,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import { previewText, renderTextAndImages } from "./render-content.js";
import { renderTerminalOutput } from "../exec/output.ts";
import {
	matchEmittedImages,
	restoreEmittedTraceImages,
} from "./trace-images.js";
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
	RuntimeToolResult,
} from "./types.js";

export { CodeModeNestedRenderStore } from "./trace-render-state.js";

type OuterImages = Parameters<typeof matchEmittedImages>[0];

export function renderTraceAndOutput(
	traces: RuntimeToolTrace[],
	droppedTraceCount: number,
	tools: CodeModeToolDefinition[],
	renderOutput: (
		visibleTraceText: ReadonlySet<string>,
	) => Component | undefined,
	options: { expanded: boolean; isPartial: boolean },
	theme: CodeModeRenderTheme,
	context: CodeModeRenderContext | undefined,
	images: OuterImages,
	renderStore: CodeModeNestedRenderStore,
	traceStates: Map<string, NestedRenderState>,
): Component {
	const visibleTraceText = new Set<string>();
	if (traces.length === 0 && droppedTraceCount === 0)
		return renderOutput(visibleTraceText) ?? new Container();
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const container = new Container();
	const match = matchEmittedImages(images);
	if (droppedTraceCount > 0) {
		container.addChild(
			new Text(
				theme.fg(
					"muted",
					`… ${droppedTraceCount} earlier nested call${droppedTraceCount === 1 ? "" : "s"} omitted`,
				),
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
			images,
			match,
			renderStore,
			traceStates,
			visibleTraceText,
		);
		for (const component of rendered) container.addChild(component);
	}
	const output = renderOutput(visibleTraceText);
	if (output) {
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
	images: OuterImages,
	match: ReturnType<typeof matchEmittedImages>,
	renderStore: CodeModeNestedRenderStore,
	traceStates: Map<string, NestedRenderState>,
	visibleTraceText: Set<string>,
): Component[] {
	const programmatic = isProgrammaticTool(tool) ? tool : undefined;
	const captured = renderStore.get(trace.id);
	const renderState = traceStates.get(trace.id) ?? { state: {} };
	traceStates.set(trace.id, renderState);
	const rendererResult = withoutEmittedImages(
		captured.result ?? restoreEmittedTraceImages(trace, images),
		match,
	);
	const rendererInput = captured.input ?? trace.input;
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
	const fullResult =
		options.expanded && !options.isPartial && trace.status === "done";
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
					showImages: rendererResult.content.some(
						(item) => item.type === "image",
					)
						? false
						: renderContext.showImages,
					lastComponent: renderState.resultComponent,
				},
			);
			renderState.resultComponent = resultComponent;
			components.push(resultComponent);
			customResultRendered = true;
			// Shell renderers show the complete output and exit status in a Text;
			// a hidden exec_command result instead returns an empty Container.
			if (
				fullResult &&
				programmatic.textOutput &&
				resultComponent instanceof Text
			)
				recordVisibleShellOutput(trace, rendererResult, visibleTraceText, true);
		} catch {
			renderState.resultComponent = undefined;
			// An extension renderer must not break the whole transcript.
		}
	}
	if (trace.status === "error" && trace.error) {
		if (!customResultRendered)
			components.push(new Text(theme.fg("error", trace.error), 4, 0));
	} else if (rendererResult && !customResultRendered) {
		const text = traceResultText(rendererResult);
		// Custom renderers can omit or transform text; only the full generic
		// renderer proves which bytes are visible.
		if (fullResult && text) {
			visibleTraceText.add(text);
			recordVisibleShellOutput(trace, rendererResult, visibleTraceText);
		}
		components.push(
			renderGenericTraceResult(
				rendererResult,
				text,
				theme,
				options.expanded || options.isPartial,
				context,
				renderState,
			),
		);
	}
	if (customResultRendered && rendererResult && context?.showImages !== false) {
		const images = rendererResult.content.filter(
			(item) => item.type === "image",
		);
		if (images.length)
			components.push(
				renderTextAndImages("", images, theme, (renderState.images ??= [])),
			);
	}
	return components;
}

function recordVisibleShellOutput(
	trace: RuntimeToolTrace,
	result: RuntimeToolResult,
	visible: Set<string>,
	custom = false,
): void {
	if (trace.name !== "exec_command" && trace.name !== "write_stdin") return;
	const text = traceResultText(result);
	const marker = "Exit code: 0\nOutput:\n";
	if (!text.startsWith(marker)) return;
	const output = text.slice(marker.length);
	if (custom) {
		const details = result.details;
		if (
			!details ||
			typeof details !== "object" ||
			!("output" in details) ||
			details.output !== output ||
			!("exit_code" in details) ||
			details.exit_code !== 0 ||
			renderTerminalOutput(output) !== output
		)
			return;
	}
	visible.add('{"exit_code":0}\nOutput:\n' + output);
	visible.add(JSON.stringify({ output, exit_code: 0 }));
}

function withoutEmittedImages(
	result: RuntimeToolResult | undefined,
	match: ReturnType<typeof matchEmittedImages>,
): RuntimeToolResult | undefined {
	if (!result) return undefined;
	const content = result.content.filter(
		(item) => item.type !== "image" || match(item) < 0,
	);
	return content.length === result.content.length
		? result
		: { ...result, content };
}

function renderGenericTraceCall(
	trace: RuntimeToolTrace,
	theme: CodeModeRenderTheme,
	expanded: boolean,
): Text {
	const verb =
		trace.status === "running"
			? "Running"
			: trace.status === "blocked"
				? "Blocked"
				: trace.status === "error"
					? "Failed"
					: "Ran";
	let text = `${theme.fg("dim", "•")} ${theme.bold(`${verb} ${trace.name}`)}`;
	if (expanded) {
		const input =
			typeof trace.input === "string"
				? trace.input
				: safeRenderString(trace.input);
		if (input) text += `\n${theme.fg("dim", input)}`;
	}
	return new Text(text, 0, 0);
}

function traceResultText(result: RuntimeToolResult): string {
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

function renderGenericTraceResult(
	result: RuntimeToolResult,
	text: string,
	theme: CodeModeRenderTheme,
	full: boolean,
	context: CodeModeRenderContext | undefined,
	renderState: NestedRenderState,
): Component {
	const images =
		context?.showImages === false
			? []
			: result.content.filter(
					(item): item is typeof item & { data: string; mimeType: string } =>
						item.type === "image" &&
						typeof item.data === "string" &&
						typeof item.mimeType === "string",
				);
	const renderedText = theme.fg("dim", text);
	return renderTextAndImages(
		full ? renderedText : previewText(renderedText, theme, false, context),
		images,
		theme,
		(renderState.images ??= []),
	);
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
