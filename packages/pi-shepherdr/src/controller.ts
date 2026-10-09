import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	contextBriefingWindow,
	hasContextRollover,
	recordContextBriefing,
	registerContextBriefing,
} from "@howaboua/pi-agent-board/integration";
import type { AgentBoard } from "./board/host.js";
import { controlPanelStatus, openControlPanel } from "./control-panel.js";
import { sendPolicyMessage } from "./delivery.js";
import type { AgentFleet } from "./fleet.js";
import { activeAgentsBriefing, orchestrationGuidance } from "./messages.js";
import type { createPeerCommands } from "./peer-commands.js";
import { loadAgentProfiles } from "./profiles.js";

const ORCHESTRATION_STATE_TYPE = "pi-shepherdr-orchestration-state";

export function registerAgentController(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	board: AgentBoard,
	peerCommands: ReturnType<typeof createPeerCommands>,
): void {
	let orchestrationEnabled = false;
	const panels = new Set<Promise<void>>();
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
		const content = await orchestrationMessage(enabled);
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
	registerContextBriefing(
		pi,
		"orchestration",
		(ctx) => restoreOrchestrationState(ctx).enabled,
		async (ctx, windowId, messages) => {
			const sessionId = ctx.sessionManager.getSessionId();
			const state = restoreOrchestrationState(ctx);
			const window = contextBriefingWindow(ctx, windowId);
			// Initialization and compaction may keep earlier messages. Only actual
			// selected context proves a toggle still supplies this window's guidance.
			if (
				state.visible &&
				messages?.some(
					(message) =>
						message.role === "custom" &&
						message.customType === ORCHESTRATION_STATE_TYPE &&
						message.timestamp === state.timestamp,
				)
			)
				return;
			const key = JSON.stringify([sessionId, window, state.id]);
			await recordContextBriefing(
				pi,
				ctx,
				"shepherdr-orchestration",
				key,
				async () => {
					const content = await orchestrationMessage(state.enabled);
					if (
						ctx.sessionManager.getSessionId() !== sessionId ||
						restoreOrchestrationState(ctx).id !== state.id
					)
						throw new Error("Orchestration changed during its briefing");
					ctx.signal?.throwIfAborted();
					return content;
				},
			);
		},
	);
	registerContextBriefing(
		pi,
		"active agents",
		() => fleet.list().some((agent) => agent.activity.phase !== "settled"),
		async (ctx, windowId) => {
			if (!hasContextRollover(ctx)) return;
			const key = JSON.stringify([
				ctx.sessionManager.getSessionId(),
				contextBriefingWindow(ctx, windowId),
			]);
			await recordContextBriefing(
				pi,
				ctx,
				"shepherdr-active-agents",
				key,
				async () => activeAgentsBriefing(fleet.list(), fleet.statuses()),
			);
		},
	);
	pi.registerCommand("herdr", {
		description: "Shepherdr settings, status and SSH setup",
		handler: async (args, ctx) => {
			if (await peerCommands.handle(args, ctx)) return;
			const commandSignal = sessionLifetime.signal;
			const commandSessionId = ctx.sessionManager.getSessionId();
			const current = () =>
				!commandSignal.aborted &&
				ctx.sessionManager.getSessionId() === commandSessionId;
			if (args.trim()) {
				ctx.ui.notify("Open /herdr, then choose a tab.", "warning");
				return;
			}
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
			orchestrationEnabled = restoreOrchestrationState(ctx).enabled;
			try {
				if (ctx.mode === "tui") {
					const panel = openControlPanel(ctx, options);
					panels.add(panel);
					try {
						await panel;
					} finally {
						panels.delete(panel);
					}
				} else ctx.ui.notify(controlPanelStatus(ctx, options), "info");
			} catch (error) {
				if (current()) ctx.ui.notify(String(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		resetLifetime();
		orchestrationEnabled = restoreOrchestrationState(ctx).enabled;
		await activateController(fleet, ctx);
	});

	pi.on("session_shutdown", async () => {
		sessionLifetime.abort();
		fleet.deactivate();
		await Promise.allSettled(panels);
	});
}

async function orchestrationMessage(enabled: boolean): Promise<string> {
	return orchestrationGuidance(
		enabled,
		enabled && (await loadAgentProfiles()).has("general"),
	);
}

function restoreOrchestrationState(ctx: ExtensionContext) {
	let enabled = false;
	let timestamp: number | undefined;
	let id = "normal";
	let visible = false;
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
			timestamp = Date.parse(entry.timestamp);
			id = entry.id;
			visible = entry.type === "custom_message";
		}
	}
	return { enabled, timestamp, id, visible };
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
