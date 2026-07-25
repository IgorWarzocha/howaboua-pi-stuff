import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { CHANGELOG_URL, DISCORD_URL, GITHUB_URL, ISSUE_URL, openExternalUrl } from "./links.ts";

const LINKS = {
	g: { url: GITHUB_URL, label: "github", message: "Opened GitHub" },
	c: { url: CHANGELOG_URL, label: "changes", message: "Opened changelog" },
	d: { url: DISCORD_URL, label: "discord", message: "Opened Discord" },
	i: { url: ISSUE_URL, label: "issue", message: "Opened issue form" },
} as const;

export function renderAboutTab(theme: Theme): string[] {
	return Object.entries(LINKS).map(([key, link]) =>
		`${theme.bold(key)} ${link.label.padEnd(7)} ${theme.fg("dim", link.url)}`,
	);
}

export function handleAboutTabInput(data: string, ctx: ExtensionContext): boolean {
	const key = data.toLowerCase() as keyof typeof LINKS;
	const target = LINKS[key];
	if (!target) return false;
	openExternalUrl(target.url);
	ctx.ui.notify(target.message, "info");
	return true;
}
