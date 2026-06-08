import { Text } from "@earendil-works/pi-tui";
import type { RenderTheme } from "./codex-rendering.ts";

export function renderCodexToolCell(title: string, detail: string | undefined, theme: RenderTheme): Text {
	let text = `${theme.fg("dim", "•")} ${theme.bold(title)}`;
	if (detail?.trim()) {
		text += `\n${theme.fg("dim", "  └ ")}${theme.fg("accent", detail.trim())}`;
	}
	return new Text(text, 0, 0);
}
