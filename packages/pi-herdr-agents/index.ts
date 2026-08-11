import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentMonitor } from "./src/monitor.js";
import { registerHerdrAgentsTool } from "./src/tool.js";

export default function herdrAgentsExtension(pi: ExtensionAPI): void {
	let monitor: AgentMonitor | undefined;
	const getMonitor = () => (monitor ??= new AgentMonitor(pi));

	registerHerdrAgentsTool(pi, getMonitor);

	pi.on("session_start", async (_event, ctx) => {
		if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"])
			return;
		try {
			await getMonitor().activate(ctx);
		} catch (error) {
			ctx.ui.notify(
				`Herdr agents could not start: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	});

	pi.on("session_shutdown", async () => {
		monitor?.deactivate();
	});
}
