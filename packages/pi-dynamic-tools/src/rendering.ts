import {
	highlightCode,
	keyHint,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import { Container, Image, Spacer, Text } from "@earendil-works/pi-tui";

export interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

export interface RenderContext {
	toolCallId?: string | undefined;
	expanded?: boolean | undefined;
	isError?: boolean | undefined;
	invalidate?: (() => void) | undefined;
}

interface ToolContent {
	type: string;
	text?: string | undefined;
	data?: string | undefined;
	mimeType?: string | undefined;
}

export interface CodeModeResultDetails {
	cellId?: string | undefined;
	status?: "yielded" | "terminated" | "result" | undefined;
	notification?: boolean | undefined;
}

type RenderStatus = "running" | "done" | "yielded";

export interface CodeModeRenderTracker {
	register(
		toolCallId: string | undefined,
		invalidate: (() => void) | undefined,
	): void;
	start(toolCallId: string): void;
	finish(toolCallId: string, status?: Exclude<RenderStatus, "running">): void;
	status(toolCallId: string | undefined): RenderStatus;
}

export function createCodeModeRenderTracker(): CodeModeRenderTracker {
	const entries = new Map<
		string,
		{ status: RenderStatus; invalidate?: (() => void) | undefined }
	>();
	return {
		register(toolCallId, invalidate) {
			if (!toolCallId) return;
			const entry = entries.get(toolCallId) ?? { status: "running" as const };
			entry.invalidate = invalidate;
			entries.set(toolCallId, entry);
		},
		start(toolCallId) {
			const entry = entries.get(toolCallId) ?? { status: "running" as const };
			const changed = entry.status !== "running";
			entry.status = "running";
			entries.set(toolCallId, entry);
			if (changed) entry.invalidate?.();
		},
		finish(toolCallId, status = "done") {
			const entry = entries.get(toolCallId) ?? { status: "done" as const };
			const changed = entry.status !== status;
			entry.status = status;
			entries.set(toolCallId, entry);
			if (changed) entry.invalidate?.();
		},
		status(toolCallId) {
			return toolCallId
				? (entries.get(toolCallId)?.status ?? "running")
				: "running";
		},
	};
}

export function renderExecCall(
	args: { code?: unknown },
	theme: RenderTheme,
	context: RenderContext | undefined,
	tracker: CodeModeRenderTracker,
): Text {
	tracker.register(context?.toolCallId, context?.invalidate);
	const code = typeof args.code === "string" ? args.code : "";
	const status = tracker.status(context?.toolCallId);
	const verb =
		status === "running" ? "Running" : status === "yielded" ? "Started" : "Ran";
	let text = `${theme.fg("dim", "•")} ${theme.bold(`${verb} code`)}`;
	const names = dynamicToolNames(code);
	if (names.length > 0) {
		text += `\n${theme.fg("dim", "  └ ")}${theme.fg("accent", names.join(" · "))}`;
	}
	if (context?.expanded && code.trim()) {
		text += `\n\n${highlightCode(code, "javascript").join("\n")}`;
	}
	return new Text(text, 0, 0);
}

export function renderWaitCall(
	args: { cell_id?: unknown; terminate?: unknown },
	theme: RenderTheme,
	context: RenderContext | undefined,
	tracker: CodeModeRenderTracker,
): Text {
	tracker.register(context?.toolCallId, context?.invalidate);
	const done = tracker.status(context?.toolCallId) !== "running";
	const terminate = args.terminate === true;
	const title = terminate
		? done
			? "Terminated code cell"
			: "Terminating code cell"
		: done
			? "Waited for code cell"
			: "Waiting for code cell";
	const cell = typeof args.cell_id === "string" ? ` #${args.cell_id}` : "";
	return new Text(
		`${theme.fg("dim", "•")} ${theme.bold(title)}${theme.fg("muted", cell)}`,
		0,
		0,
	);
}

export function renderCodeModeResult(
	result: { content: ToolContent[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: RenderTheme,
	context?: RenderContext,
): Text | Container {
	const details = asDetails(result.details);
	const content =
		details.notification || details.status === undefined
			? result.content
			: result.content.slice(1);
	const text = content
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
	const status = statusText(details);
	const output = [text, status].filter(Boolean).join("\n");
	const tone = context?.isError
		? "error"
		: details.status === "yielded"
			? "accent"
			: "dim";
	const renderedText = output ? theme.fg(tone, output) : "";
	const images = content.filter(
		(item): item is ToolContent & { data: string; mimeType: string } =>
			item.type === "image" &&
			typeof item.data === "string" &&
			typeof item.mimeType === "string",
	);

	if (options.expanded || options.isPartial) {
		return renderTextAndImages(renderedText, images, theme);
	}
	const preview = previewText(renderedText, theme);
	return renderTextAndImages(preview, images, theme);
}

export function renderTrackedCodeModeResult(
	result: { content: ToolContent[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: RenderTheme,
	context: RenderContext | undefined,
	tracker: CodeModeRenderTracker,
): Text | Container {
	if (!options.isPartial && context?.toolCallId) {
		const details = asDetails(result.details);
		tracker.finish(
			context.toolCallId,
			details.status === "yielded" ? "yielded" : "done",
		);
	}
	return renderCodeModeResult(result, options, theme, context);
}

function dynamicToolNames(code: string): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const match of code.matchAll(
		/\btools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
	)) {
		const name = match[1]!;
		if (seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}

function asDetails(value: unknown): CodeModeResultDetails {
	return value && typeof value === "object"
		? (value as CodeModeResultDetails)
		: {};
}

function statusText(details: CodeModeResultDetails): string {
	if (details.status === "yielded" && details.cellId)
		return `Cell #${details.cellId} still running`;
	if (details.status === "terminated")
		return details.cellId
			? `Cell #${details.cellId} terminated`
			: "Cell terminated";
	return "";
}

function previewText(text: string, theme: RenderTheme): string {
	if (!text) return "";
	const preview = truncateToVisualLines(text, 5, 100, 0);
	if (preview.skippedCount <= 0) return preview.visualLines.join("\n");
	let hint: string;
	try {
		hint = keyHint("app.tools.expand", "to expand");
	} catch {
		hint = "ctrl+o to expand";
	}
	return `${theme.fg("muted", `... (${preview.skippedCount} more lines, ${hint})`)}\n${preview.visualLines.join("\n")}`;
}

function renderTextAndImages(
	text: string,
	images: Array<ToolContent & { data: string; mimeType: string }>,
	theme: RenderTheme,
): Text | Container {
	if (images.length === 0) return new Text(text, text ? 4 : 0, 0);
	const container = new Container();
	if (text) container.addChild(new Text(text, 4, 0));
	for (const [index, image] of images.entries()) {
		if (text || index > 0) container.addChild(new Spacer(1));
		container.addChild(
			new Image(
				image.data,
				image.mimeType,
				{ fallbackColor: (value) => theme.fg("dim", value) },
				{ maxWidthCells: 60, maxHeightCells: 20 },
			),
		);
	}
	return container;
}
