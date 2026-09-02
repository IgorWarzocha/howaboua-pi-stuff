import { Text } from "@earendil-works/pi-tui";

interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

export function renderToolCell(
	title: string,
	detail: string | undefined,
	theme: RenderTheme,
): Text {
	return new Text(
		theme.fg("toolTitle", theme.bold(title)) +
			(detail ? " " + theme.fg("muted", detail) : ""),
		0,
		0,
	);
}
