import {
	type KeybindingHints,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Image,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type { CodeModeRenderTheme } from "./types.js";

export interface RenderedToolContent {
	type: string;
	text?: string | undefined;
	data?: string | undefined;
	mimeType?: string | undefined;
}

export function imagesByMimeType(
	contents: Array<RenderedToolContent & { data: string; mimeType: string }>,
): Map<string, Set<string>> {
	const images = new Map<string, Set<string>>();
	for (const item of contents) {
		const data = images.get(item.mimeType) ?? new Set<string>();
		data.add(item.data);
		images.set(item.mimeType, data);
	}
	return images;
}

export function previewText(text: string, theme: CodeModeRenderTheme, hideBody = false, hints?: Partial<KeybindingHints>): string {
	if (!text) return "";
	const preview = truncateToVisualLines(text, 5, 100, 0);
	if (hideBody) {
		const lines = preview.skippedCount + preview.visualLines.length;
		return theme.fg("muted", `... (${lines} ${lines === 1 ? "line" : "lines"}, ${expandHint(hints)})`);
	}
	if (preview.skippedCount <= 0) return preview.visualLines.join("\n");
	return `${theme.fg("muted", `... (${preview.skippedCount} more lines, ${expandHint(hints)})`)}\n${preview.visualLines.join("\n")}`;
}

export function expandHint(hints?: Partial<KeybindingHints>): string {
	return hints?.keyHint?.("app.tools.expand", "to expand") ?? "expand tool details";
}

export function renderTextAndImages(
	text: string,
	images: Array<RenderedToolContent & { data: string; mimeType: string }>,
	theme: CodeModeRenderTheme,
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
