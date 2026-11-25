import { Text } from "@earendil-works/pi-tui";
export interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

export function renderCodexToolCell(
	title: string,
	detail: string | undefined,
	theme: RenderTheme,
): Text {
	let text = `${theme.fg("dim", "•")} ${theme.bold(title)}`;
	if (detail?.trim()) {
		text += `\n${theme.fg("dim", "  └ ")}${theme.fg("accent", detail.trim())}`;
	}
	return new Text(text, 0, 0);
}
