import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "pi-codex-conversion-lite-graduation";
const REMOVE_COMMAND = "pi remove npm:@howaboua/pi-codex-conversion-lite";
const INSTALL_COMMAND = "pi install npm:@howaboua/pi-codex-conversion";

export function registerLiteGraduationNotice(pi: ExtensionAPI): void {
	pi.registerEntryRenderer(ENTRY_TYPE, (_entry, _options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text([
			theme.bold(theme.fg("customMessageLabel", "pi-codex-conversion-lite has graduated to the main channel")),
			theme.fg("customMessageText", "No further updates will be provided after this release."),
			`${theme.fg("customMessageText", "Remove Lite: ")}${theme.fg("accent", REMOVE_COMMAND)}`,
			`${theme.fg("customMessageText", "Install main: ")}${theme.fg("accent", INSTALL_COMMAND)}`,
			theme.fg("customMessageText", "Thank you for testing!"),
		].join("\n"), 0, 0));
		return box;
	});

	pi.on("session_start", (event, ctx) => {
		if (event.reason === "startup" && ctx.mode === "tui") pi.appendEntry(ENTRY_TYPE, {});
	});
}
