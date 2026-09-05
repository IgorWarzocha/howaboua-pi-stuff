import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sendPolicyMessage } from "./delivery.js";
import type { AgentFleet } from "./fleet.js";
import { showMachineMenu } from "./machine-menu.js";
import { loadAgentProfiles } from "./profiles.js";

const ORCHESTRATION_STATE_TYPE = "pi-shepherdr-orchestration-state";
const GENERAL_ORCHESTRATION_MESSAGE =
	"Your main goal from now on is to orchestrate agents. Fan out suitable work to general agents, synthesize their results, and report the outcome. Work directly only when asked or for routine local tasks.";
const ORCHESTRATION_MESSAGE =
	"Your main goal from now on is to orchestrate agents. Fan out suitable work, synthesize agent results, and report the outcome. Work directly only when asked or for routine local tasks.";
const NORMAL_MESSAGE = "Work normally. Delegate only when useful or requested.";

export function registerAgentController(
	pi: ExtensionAPI,
	fleet: AgentFleet,
): void {
	let orchestrationEnabled = false;
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
				orchestrationEnabled = restoreOrchestrationState(ctx);
				orchestrationEnabled = !orchestrationEnabled;
				sendPolicyMessage(
					pi,
					{
						customType: ORCHESTRATION_STATE_TYPE,
						content: orchestrationEnabled
							? await orchestrationMessage()
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
					await activateController(fleet, ctx);
					if (!fleet.isActive()) return;
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
		orchestrationEnabled = restoreOrchestrationState(ctx);
		await activateController(fleet, ctx);
	});

	pi.on("session_shutdown", () => {
		fleet.deactivate();
	});
}

async function orchestrationMessage(): Promise<string> {
	return (await loadAgentProfiles()).has("general")
		? GENERAL_ORCHESTRATION_MESSAGE
		: ORCHESTRATION_MESSAGE;
}

function restoreOrchestrationState(ctx: ExtensionContext): boolean {
	let enabled = false;
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
		}
	}
	return enabled;
}

async function activateController(
	fleet: AgentFleet,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"]) {
		ctx.ui.notify("Shepherdr requires Pi to run inside Herdr", "error");
		return false;
	}
	try {
		await fleet.activate(ctx);
		return true;
	} catch (error) {
		fleet.deactivate();
		ctx.ui.notify(
			`Shepherdr could not start: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return false;
	}
}
