import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	readBrowserRouteConfig,
	readBrowserVoiceOnly,
} from "./src/browser/config.js";
import { registerBrowserCommand } from "./src/browser/settings.js";

/** Keep the normal browser graph out of Pi until the tool is enabled. */
export default async function browserExtension(
	pi: ExtensionAPI,
): Promise<void> {
	let voiceOnly = false;
	try {
		voiceOnly = readBrowserVoiceOnly();
	} catch {
		// Normal registration reports invalid configuration and retains local access.
	}
	if (voiceOnly) {
		registerBrowserCommand(pi);
		try {
			readBrowserRouteConfig();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pi.on("session_start", (_event, ctx) => {
				ctx.ui.notify(`${message}. Run /browser to repair it.`, "warning");
			});
		}
		return;
	}
	const { default: registerBrowser } = await import(
		"./src/browser-registration.js"
	);
	await registerBrowser(pi, { defineTool, Type });
}
