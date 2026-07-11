import { Text } from "@earendil-works/pi-tui";
export function renderCodexToolCell(title, detail, theme) {
    let text = `${theme.fg("dim", "•")} ${theme.bold(title)}`;
    if (detail?.trim()) {
        text += `\n${theme.fg("dim", "  └ ")}${theme.fg("accent", detail.trim())}`;
    }
    return new Text(text, 0, 0);
}
