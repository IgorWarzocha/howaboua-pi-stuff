import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { enableMasterDirectory, isMasterDirectory } from "./master-config.js";
import type { AgentMonitor } from "./monitor.js";

const TOOL_NAME = "herdr_agents";

export function registerMasterMode(
	pi: ExtensionAPI,
	getMonitor: () => AgentMonitor,
): void {
	let monitor: AgentMonitor | undefined;
	pi.registerCommand("herdr", {
		description: "Enable Herdr master mode for this session or directory",
		getArgumentCompletions: (prefix) =>
			["master", "json"]
				.filter((action) => action.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action !== "master" && action !== "json") {
				ctx.ui.notify("Usage: /herdr [master|json]", "warning");
				return;
			}
			monitor = getMonitor();
			if (!(await activateMaster(pi, monitor, ctx))) return;
			if (action === "master") {
				ctx.ui.notify("Herdr master enabled for this Pi session", "info");
				return;
			}
			try {
				const path = await enableMasterDirectory(ctx.cwd);
				ctx.ui.notify(`Herdr master enabled in ${path}`, "info");
			} catch (error) {
				ctx.ui.notify(
					`Herdr master is active for this session but could not save ${ctx.cwd}/.pi/herdr.json: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		monitor?.deactivate();
		let master = false;
		try {
			master = await isMasterDirectory(ctx.cwd);
		} catch (error) {
			ctx.ui.notify(
				`Herdr master config is invalid: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
		if (!master) {
			setToolActive(pi, false);
			return;
		}
		monitor = getMonitor();
		await activateMaster(pi, monitor, ctx);
	});

	pi.on("session_shutdown", async () => {
		monitor?.deactivate();
	});
}

async function activateMaster(
	pi: ExtensionAPI,
	monitor: AgentMonitor,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"]) {
		setToolActive(pi, false);
		ctx.ui.notify("Herdr master mode requires Pi to run inside Herdr", "error");
		return false;
	}
	try {
		await monitor.client.request("ping");
		setToolActive(pi, true);
		await monitor.activate(ctx);
		return true;
	} catch (error) {
		setToolActive(pi, false);
		monitor.deactivate();
		ctx.ui.notify(
			`Herdr master could not start: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return false;
	}
}

function setToolActive(pi: ExtensionAPI, active: boolean): void {
	const current = pi.getActiveTools();
	const withoutTool = current.filter((name) => name !== TOOL_NAME);
	const next = active ? [...withoutTool, TOOL_NAME] : withoutTool;
	if (
		next.length !== current.length ||
		next.some((name, index) => name !== current[index])
	) {
		pi.setActiveTools(next);
	}
}
