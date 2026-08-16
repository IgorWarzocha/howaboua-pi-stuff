import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activityStatus } from "./activity.js";
import type {
	AgentStatus,
	MachineStatus,
	ScopedMonitoredAgent,
} from "./types.js";

const WIDGET_ID = "herdr-agents";
const MAX_VISIBLE_AGENTS = 8;

function statusAppearance(status: AgentStatus): {
	icon: string;
	tone: "dim" | "error" | "success" | "warning";
} {
	switch (status) {
		case "working":
			return { icon: "◉", tone: "warning" };
		case "blocked":
			return { icon: "●", tone: "error" };
		case "done":
			return { icon: "✓", tone: "success" };
		case "idle":
			return { icon: "○", tone: "dim" };
		default:
			return { icon: "?", tone: "dim" };
	}
}

function agentLine(
	ctx: ExtensionContext,
	agent: ScopedMonitoredAgent,
	machines: Map<string, MachineStatus>,
): string {
	const theme = ctx.ui.theme;
	const status = activityStatus(agent.activity);
	const connected = machines.get(agent.machine)?.status === "connected";
	const appearance = connected
		? statusAppearance(status)
		: ({ icon: "?", tone: "error" } as const);
	const name = `${agent.machine} / ${agent.name ?? agent.paneId}`;
	const location = agent.cwd ? basename(agent.cwd) : agent.paneId;
	return [
		theme.fg("muted", "│"),
		theme.fg(appearance.tone, appearance.icon),
		theme.fg("accent", name),
		theme.fg(appearance.tone, connected ? status : "offline"),
		theme.fg("dim", `· ${location}`),
	].join(" ");
}

export function renderAgentWidget(
	ctx: ExtensionContext | undefined,
	agents: ScopedMonitoredAgent[],
	machines: MachineStatus[],
): void {
	if (!ctx?.hasUI) return;
	if (agents.length === 0) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}
	const theme = ctx.ui.theme;
	const ordered = [...agents].sort(
		(left, right) =>
			statusOrder(activityStatus(left.activity)) -
				statusOrder(activityStatus(right.activity)) ||
			(left.name ?? left.paneId).localeCompare(right.name ?? right.paneId),
	);
	const machinesByName = new Map(
		machines.map((machine) => [machine.name, machine]),
	);
	const lines = [
		`${theme.fg("accent", "╭─ herdr agents")} ${theme.fg("dim", `${agents.length} · ${machines.filter((machine) => machine.status === "connected").length}/${machines.length} machines`)}`,
		...ordered
			.slice(0, MAX_VISIBLE_AGENTS)
			.map((agent) => agentLine(ctx, agent, machinesByName)),
	];
	if (ordered.length > MAX_VISIBLE_AGENTS) {
		lines.push(
			`${theme.fg("muted", "│")} ${theme.fg("dim", `+${ordered.length - MAX_VISIBLE_AGENTS} more`)}`,
		);
	}
	lines.push(theme.fg("muted", "╰─"));
	ctx.ui.setWidget(WIDGET_ID, lines, { placement: "aboveEditor" });
}

function statusOrder(status: AgentStatus): number {
	return ["blocked", "working", "done", "idle", "unknown"].indexOf(status);
}
