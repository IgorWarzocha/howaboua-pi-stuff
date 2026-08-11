import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentStatus, MonitoredAgent } from "./types.js";

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

function agentLine(ctx: ExtensionContext, agent: MonitoredAgent): string {
	const theme = ctx.ui.theme;
	const appearance = statusAppearance(agent.lastStatus);
	const name = agent.name ?? agent.paneId;
	const location = agent.cwd ? basename(agent.cwd) : agent.paneId;
	return [
		theme.fg("muted", "│"),
		theme.fg(appearance.tone, appearance.icon),
		theme.fg("accent", name),
		theme.fg(appearance.tone, agent.lastStatus),
		theme.fg("dim", `· ${location}`),
	].join(" ");
}

export function renderAgentWidget(
	ctx: ExtensionContext | undefined,
	agents: MonitoredAgent[],
): void {
	if (!ctx?.hasUI) return;
	if (agents.length === 0) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}
	const theme = ctx.ui.theme;
	const ordered = [...agents].sort(
		(left, right) =>
			statusOrder(left.lastStatus) - statusOrder(right.lastStatus) ||
			(left.name ?? left.paneId).localeCompare(right.name ?? right.paneId),
	);
	const lines = [
		`${theme.fg("accent", "╭─ herdr agents")} ${theme.fg("dim", String(agents.length))}`,
		...ordered
			.slice(0, MAX_VISIBLE_AGENTS)
			.map((agent) => agentLine(ctx, agent)),
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
