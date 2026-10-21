import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, stateDirectory } from "./config.ts";

export async function investigateObservatory(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	scope: string,
): Promise<void> {
	const session = ctx.sessionManager.getSessionId();
	try {
		const config = await loadConfig();
		const guide = fileURLToPath(new URL("../investigate.md", import.meta.url));
		const locations = {
			database: config.database,
			sessions: config.sessions,
			tabStateRoot: join(stateDirectory(), "tabs"),
			tabBundles: config.tabs,
			currentSession: session,
			currentProject: ctx.cwd,
		};
		do {
			await ctx.waitForIdle();
		} while (!ctx.isIdle());
		if (ctx.sessionManager.getSessionId() !== session) return;
		pi.sendUserMessage(
			[
				`Read ${JSON.stringify(guide)}, then investigate the scope below.`,
				`Observatory locations: ${JSON.stringify(locations)}`,
				"",
				scope,
			].join("\n"),
		);
	} catch (error) {
		ctx.ui.notify(
			`Could not start the Observatory investigation: ${error instanceof Error ? error.message : String(error)}. Check Observatory's configuration and try again.`,
			"error",
		);
	}
}
