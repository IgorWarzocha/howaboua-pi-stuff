import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentBoard } from "./board/host.js";
import { openBoardSettings } from "./board/settings.js";
import { sendPolicyMessage } from "./delivery.js";
import type { AgentFleet } from "./fleet.js";
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
	board: AgentBoard,
): void {
	let orchestrationEnabled = false;
	pi.registerCommand("herdr", {
		description: "Toggle orchestration, message board, or reconnect machines",
		getArgumentCompletions: (prefix) =>
			[
				"connect",
				"board",
				"board on",
				"board off",
				"board inherit",
				"board on folder",
				"board off folder",
				"board inherit folder",
				"board on global",
				"board off global",
			]
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
			if (action === "connect") {
				if (!fleet.isActive()) {
					await activateController(fleet, ctx);
					if (!fleet.isActive()) return;
				}
				try {
					await fleet.reload();
					ctx.ui.notify(fleet.connect(rest[0]), "info");
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			if (action === "board") {
				try {
					if (rest.length === 0) {
						if (ctx.mode === "tui") await openBoardSettings(ctx, board);
						else ctx.ui.notify(board.status(ctx), "info");
					} else if (
						rest.length <= 2 &&
						(rest[0] === "on" || rest[0] === "off" || rest[0] === "inherit") &&
						(rest[1] === undefined ||
							rest[1] === "session" ||
							rest[1] === "folder" ||
							rest[1] === "global") &&
						!(rest[0] === "inherit" && rest[1] === "global")
					) {
						await board.setSetting(
							ctx,
							rest[1] ?? "session",
							rest[0] === "inherit" ? undefined : rest[0] === "on",
						);
						ctx.ui.notify(board.status(ctx), "info");
					} else
						ctx.ui.notify(
							"Usage: /herdr board [on|off|inherit [session|folder] | on|off global]",
							"warning",
						);
				} catch (error) {
					ctx.ui.notify(String(error), "error");
				}
				return;
			}
			ctx.ui.notify("Usage: /herdr [connect [machine] | board]", "warning");
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
