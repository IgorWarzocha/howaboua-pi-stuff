import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentBoard } from "./board/host.js";
import { controlPanelStatus, openControlPanel } from "./control-panel.js";
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
	let sessionLifetime = new AbortController();
	const resetLifetime = () => {
		sessionLifetime.abort();
		sessionLifetime = new AbortController();
	};
	const setOrchestration = async (
		ctx: ExtensionContext,
		enabled: boolean,
		signal: AbortSignal,
	) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const content = enabled ? await orchestrationMessage() : NORMAL_MESSAGE;
		signal.throwIfAborted();
		if (ctx.sessionManager.getSessionId() !== sessionId)
			throw new Error("Session changed; retry /herdr");
		orchestrationEnabled = enabled;
		sendPolicyMessage(
			pi,
			{
				customType: ORCHESTRATION_STATE_TYPE,
				content,
				details: { enabled },
				display: true,
			},
			{ triggerTurn: false },
		);
	};
	const reconnect = async (
		ctx: ExtensionContext,
		machine: string | undefined,
		signal: AbortSignal,
	) => {
		if (!fleet.isActive()) {
			await activateController(fleet, ctx);
			signal.throwIfAborted();
			if (!fleet.isActive())
				throw new Error("Fleet inactive. Pi must run inside Herdr.");
		}
		await fleet.reload();
		signal.throwIfAborted();
		return fleet.connect(machine);
	};
	pi.registerCommand("herdr", {
		description:
			"Shepherdr control panel, board settings and machine connections",
		getArgumentCompletions: (prefix) =>
			[
				"orchestration",
				"orchestration on",
				"orchestration off",
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
			const commandSignal = sessionLifetime.signal;
			const commandSessionId = ctx.sessionManager.getSessionId();
			const current = () =>
				!commandSignal.aborted &&
				ctx.sessionManager.getSessionId() === commandSessionId;
			const [rawAction = "", ...rest] = args.trim().split(/\s+/);
			const action = rawAction.toLowerCase();
			const options = {
				fleet,
				board,
				orchestration: () => orchestrationEnabled,
				setOrchestration: (enabled: boolean, signal: AbortSignal) =>
					setOrchestration(ctx, enabled, signal),
				reconnect: (machine: string | undefined, signal: AbortSignal) =>
					reconnect(ctx, machine, signal),
				signal: commandSignal,
			};
			if (!action) {
				orchestrationEnabled = restoreOrchestrationState(ctx);
				try {
					if (ctx.mode === "tui") await openControlPanel(ctx, options);
					else ctx.ui.notify(controlPanelStatus(ctx, options), "info");
				} catch (error) {
					if (current()) ctx.ui.notify(String(error), "error");
				}
				return;
			}
			if (action === "orchestration") {
				if (
					rest.length > 1 ||
					(rest[0] !== undefined && rest[0] !== "on" && rest[0] !== "off")
				) {
					ctx.ui.notify("Usage: /herdr orchestration [on|off]", "warning");
					return;
				}
				orchestrationEnabled = restoreOrchestrationState(ctx);
				if (!rest.length)
					ctx.ui.notify(
						`Orchestration ${orchestrationEnabled ? "on" : "off"}.`,
						"info",
					);
				else
					try {
						await setOrchestration(ctx, rest[0] === "on", commandSignal);
						ctx.ui.notify(
							orchestrationEnabled
								? "Agent orchestration enabled"
								: "Normal mode enabled",
							"info",
						);
					} catch (error) {
						if (current()) ctx.ui.notify(String(error), "error");
					}
				return;
			}
			if (action === "connect") {
				try {
					ctx.ui.notify(await reconnect(ctx, rest[0], commandSignal), "info");
				} catch (error) {
					if (current())
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
						if (ctx.mode === "tui") {
							orchestrationEnabled = restoreOrchestrationState(ctx);
							await openControlPanel(ctx, options, "board:session");
						} else ctx.ui.notify(board.status(ctx), "info");
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
						if (current()) ctx.ui.notify(board.status(ctx), "info");
					} else
						ctx.ui.notify(
							"Usage: /herdr board [on|off|inherit [session|folder] | on|off global]",
							"warning",
						);
				} catch (error) {
					if (current()) ctx.ui.notify(String(error), "error");
				}
				return;
			}
			ctx.ui.notify(
				"Usage: /herdr [orchestration [on|off] | connect [machine] | board]",
				"warning",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		resetLifetime();
		orchestrationEnabled = restoreOrchestrationState(ctx);
		await activateController(fleet, ctx);
	});

	pi.on("session_shutdown", () => {
		sessionLifetime.abort();
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
