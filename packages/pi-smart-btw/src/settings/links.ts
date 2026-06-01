import { spawn } from "node:child_process";

export const GITHUB_URL =
	"https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-smart-btw";
export const CHANGELOG_URL = `${GITHUB_URL}/CHANGELOG.md`;
export const ISSUE_URL =
	"https://github.com/IgorWarzocha/howaboua-pi-stuff/issues/new";

export function openExternalUrl(url: string): void {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", (error) => {
		console.warn(`[pi-smart-btw] Failed to open ${url}: ${error.message}`);
	});
	child.unref();
}
