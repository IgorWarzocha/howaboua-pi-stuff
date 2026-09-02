import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentFleet } from "./fleet.js";
import { showMachineMenu } from "./machine-menu.js";

interface AgentControllerOptions {
	onActiveChange?(): void;
	toolName?: string;
}

const ORCHESTRATION_STATE_TYPE = "pi-shepherdr-orchestration-state";
const ORCHESTRATION_MESSAGE =
	"Your main goal from now on is to orchestrate agents. Fan out suitable work to general agents, synthesize their results, and report the outcome. Work directly only when asked or for routine local tasks.";
const NORMAL_MESSAGE = "Work normally. Delegate only when useful or requested.";

export function registerAgentController(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	options: AgentControllerOptions = {},
): void {
	let orchestrationEnabled = false;
	const setActive = (active: boolean) => {
		setToolActive(pi, options.toolName ?? "herdr_agents", active);
		options.onActiveChange?.();
	};
	pi.registerCommand("herdr", {
		description: "Toggle agent orchestration or manage Herdr machines",
		getArgumentCompletions: (prefix) =>
			["machines", "connect"]
				.filter((action) => action.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			const [rawAction = "", ...rest] = args.trim().split(/\s+/);
			const action = rawAction.toLowerCase();
			if (!action) {
				orchestrationEnabled = restoreOrchestrationState(ctx).enabled;
				if (
					!fleet.isActive() &&
					!(await activateController(fleet, ctx, setActive))
				) {
					return;
				}
				orchestrationEnabled = !orchestrationEnabled;
				pi.sendMessage(
					{
						customType: ORCHESTRATION_STATE_TYPE,
						content: orchestrationEnabled
							? ORCHESTRATION_MESSAGE
							: NORMAL_MESSAGE,
						details: { enabled: orchestrationEnabled },
						display: true,
					},
					{ triggerTurn: false },
				);
				ctx.ui.notify(
					orchestrationEnabled
						? "Agent orchestration enabled"
						: "Normal mode enabled",
					"info",
				);
				return;
			}
			if (action === "machines") {
				await showMachineMenu(fleet, ctx);
				return;
			}
			if (action === "connect") {
				if (!fleet.isActive()) {
					ctx.ui.notify("Run /herdr to activate agents first", "warning");
					return;
				}
				try {
					ctx.ui.notify(fleet.connect(rest[0]), "info");
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			ctx.ui.notify("Usage: /herdr [machines|connect [machine]]", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const state = restoreOrchestrationState(ctx);
		orchestrationEnabled = state.enabled;
		fleet.deactivate();
		setActive(false);
		if (state.recorded) await activateController(fleet, ctx, setActive);
	});

	pi.on("session_shutdown", () => {
		fleet.deactivate();
	});
}

function restoreOrchestrationState(ctx: ExtensionContext): {
	enabled: boolean;
	recorded: boolean;
} {
	let enabled = false;
	let recorded = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (
			(entry.type !== "custom" && entry.type !== "custom_message") ||
			entry.customType !== ORCHESTRATION_STATE_TYPE
		) {
			continue;
		}
		const state = entry.type === "custom" ? entry.data : entry.details;
		if (
			typeof state === "object" &&
			state !== null &&
			"enabled" in state &&
			typeof state.enabled === "boolean"
		) {
			enabled = state.enabled;
			recorded = true;
		}
	}
	return { enabled, recorded };
}

async function activateController(
	fleet: AgentFleet,
	ctx: ExtensionContext,
	setActive: (active: boolean) => void,
): Promise<boolean> {
	if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"]) {
		setActive(false);
		ctx.ui.notify(
			"Agent orchestration requires Pi to run inside Herdr",
			"error",
		);
		return false;
	}
	try {
		await fleet.activate(ctx);
		setActive(true);
		return true;
	} catch (error) {
		fleet.deactivate();
		setActive(false);
		ctx.ui.notify(
			`Agent orchestration could not start: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return false;
	}
}

function setToolActive(
	pi: ExtensionAPI,
	toolName: string,
	active: boolean,
): void {
	const current = pi.getActiveTools();
	const withoutTool = current.filter((name) => name !== toolName);
	const next = active ? [...withoutTool, toolName] : withoutTool;
	if (
		next.length !== current.length ||
		next.some((name, index) => name !== current[index])
	) {
		pi.setActiveTools(next);
	}
}
