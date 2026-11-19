import {
	type KeybindingHints,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import type { Container, Text } from "@earendil-works/pi-tui";
import {
	type RenderedImage,
	renderTextWithImages,
} from "../../ui/tool-rendering/media.ts";
import type { CodeModeRenderTheme } from "./types.js";

export type { RenderedImage } from "../../ui/tool-rendering/media.ts";

export interface RenderedToolContent {
	type: string;
	text?: string | undefined;
	data?: string | undefined;
	mimeType?: string | undefined;
}

export function previewText(
	text: string,
	theme: CodeModeRenderTheme,
	hideBody = false,
	hints?: Partial<KeybindingHints>,
): string {
	if (!text) return "";
	const preview = truncateToVisualLines(text, 5, 100, 0);
	if (hideBody) {
		const lines = preview.skippedCount + preview.visualLines.length;
		return theme.fg(
			"muted",
			`... (${lines} ${lines === 1 ? "line" : "lines"}, ${expandHint(hints)})`,
		);
	}
	if (preview.skippedCount <= 0) return preview.visualLines.join("\n");
	return `${theme.fg("muted", `... (${preview.skippedCount} more lines, ${expandHint(hints)})`)}\n${preview.visualLines.join("\n")}`;
}

export function expandHint(hints?: Partial<KeybindingHints>): string {
	return (
		hints?.keyHint?.("app.tools.expand", "to expand") ?? "expand tool details"
	);
}

export function renderTextAndImages(
	text: string,
	images: Array<RenderedToolContent & { data: string; mimeType: string }>,
	theme: CodeModeRenderTheme,
	imageCache: RenderedImage[] = [],
): Text | Container {
	return renderTextWithImages(text, images, theme, {
		paddingX: text ? 4 : 0,
		maxHeightCells: 20,
		imageCache,
	});
}
