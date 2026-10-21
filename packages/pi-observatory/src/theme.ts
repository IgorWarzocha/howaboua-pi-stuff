import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Theme, ThemeToken } from "@earendil-works/pi-coding-agent";
import { colorToHex } from "@earendil-works/pi-tui";
import { stateDirectory } from "./config.ts";

function themeCss(theme: Theme): string {
	const tokens = {
		bg: "userMessageBg",
		fg: "text",
		muted: "muted",
		line: "borderMuted",
		surface: "customMessageBg",
		hover: "selectedBg",
		accent: "accent",
		"accent-soft": "selectedBg",
		success: "success",
		issue: "error",
		warning: "warning",
		gap: "dim",
		unknown: "muted",
	} satisfies Record<string, ThemeToken>;
	const colors = theme.colors;
	const variables = Object.entries(tokens).map(
		([name, token]) => `--${name}: ${colorToHex(colors[token])};`,
	);
	return `:root { color-scheme: ${theme.appearance}; ${variables.join(" ")} }\n`;
}

// The detached viewer shares one palette, updated only by an explicit opening.
export async function saveTheme(theme: Theme): Promise<void> {
	const directory = stateDirectory();
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `theme-${randomUUID()}.css`);
	try {
		await writeFile(temporary, themeCss(theme), { mode: 0o600 });
		await rename(temporary, join(directory, "theme.css"));
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function readThemeCss(): Promise<string> {
	try {
		return await readFile(join(stateDirectory(), "theme.css"), "utf8");
	} catch (error) {
		// Standalone viewers use the browser palette until opened from Pi.
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return "";
		throw error;
	}
}
