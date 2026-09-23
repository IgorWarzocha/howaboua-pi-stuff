import type { AgentsParams, READ_SOURCES } from "./agents-contract.js";
import type { AgentFleet, ConnectedMachine } from "./fleet.js";
import { loadAgentProfiles } from "./profiles.js";
import type { AgentStatus, PaneInfo, SessionSnapshot } from "./types.js";

const MAX_LIST_ITEMS = 30;
const MAX_TERMINAL_READ_CHARS = 36_000;

export async function agentsHelp(): Promise<Record<string, unknown>> {
	const profiles = await loadAgentProfiles();
	return {
		actions: {
			help: "",
			list: "machine?",
			find: "query? status? machine?",
			spawn:
				"agent_type label message name? machine? placement? workspace? pane? cwd? base? blocking?",
			watch: "target machine?",
			unwatch: "target machine?",
			send: "target message machine?",
			assign: "target message machine? blocking?",
			read: "target machine? source? lines?",
			answer: "target ask_id answers machine?",
		},
		rules: {
			machine:
				"Omit for local (host running Pi); list/find omit for all machines. Remote: profile ID from list, not label/hostname",
			target: "Use spawn/find target exactly",
			label: "2-3 words; tab/session",
			answers: "[{selections?:string[],other?:string,comment?:string}]",
			ask_id: "Exact pending Ask ID",
			send: "Peer questions, updates, replies; submission only, no wait or watch",
			assign: "Delegate a task to an existing agent",
			blocking:
				"spawn/assign default true; false pushes task settlement; never poll. Reviewer spawns always block; await review before working its scope",
			watch:
				"Explicit watch persists until unwatch; automatic task watches end on finish/failure, not blockage",
			prompt:
				"Only task + inaccessible context; no method/evidence/reporting boilerplate",
			slash:
				"Leading / uses target Pi commands/skills/templates; extension commands are submission-only, even with assign/spawn; TUI-only commands unavailable",
			reuse:
				"Reuse only same investigation; reviews independent; new scope = new agent",
			...(profiles.has("general")
				? {
						general: "Only when requested/orchestrating",
					}
				: {}),
		},
		profiles: Object.fromEntries(
			[...profiles].map(([name, profile]) => [name, profile.description]),
		),
		advanced: "herdr --skill: workspace/tab/pane/process/focus/layout/terminal",
	};
}

function labels(snapshot: SessionSnapshot) {
	return {
		panes: new Map(snapshot.panes.map((pane) => [pane.pane_id, pane.label])),
		tabs: new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab.label])),
		workspaces: new Map(
			snapshot.workspaces.map((workspace) => [
				workspace.workspace_id,
				workspace.label,
			]),
		),
	};
}

function compactAgent(
	agent: PaneInfo,
	snapshot: SessionSnapshot,
	machine: string,
	monitored: boolean,
): Record<string, unknown> {
	const names = labels(snapshot);
	return {
		machine,
		target: agent.pane_id,
		...(agent.name ? { name: agent.name } : {}),
		...(agent.label || names.panes.get(agent.pane_id)
			? { label: agent.label ?? names.panes.get(agent.pane_id) }
			: {}),
		status: agent.agent_status,
		cwd: agent.foreground_cwd ?? agent.cwd ?? null,
		workspace: names.workspaces.get(agent.workspace_id) ?? agent.workspace_id,
		tab: names.tabs.get(agent.tab_id) ?? agent.tab_id,
		monitored,
	};
}

function matchesAgent(
	agent: Record<string, unknown>,
	query: string | undefined,
	status: AgentStatus | undefined,
): boolean {
	if (status && agent["status"] !== status) return false;
	if (!query) return true;
	const haystack = Object.values(agent)
		.filter((value) => typeof value === "string")
		.join("\n")
		.toLowerCase();
	return haystack.includes(query.toLowerCase());
}

export async function listFleetAgents(
	fleet: AgentFleet,
	params: Pick<AgentsParams, "machine" | "query" | "status">,
): Promise<Record<string, unknown>> {
	const [profiles, machines] = await Promise.all([
		loadAgentProfiles(),
		fleet.snapshots(params.machine),
	]);
	const agents = machines.flatMap((machine) => {
		if (!machine.snapshot) return [];
		return machine.snapshot.agents
			.filter(
				(agent) =>
					agent.agent === "pi" &&
					(!machine.local || agent.pane_id !== process.env["HERDR_PANE_ID"]),
			)
			.map((agent) =>
				compactAgent(
					agent,
					machine.snapshot!,
					machine.id,
					machine.monitoredPaneIds?.has(agent.pane_id) ?? false,
				),
			)
			.filter((agent) => matchesAgent(agent, params.query, params.status));
	});
	const workspaces = machines.flatMap((machine) =>
		(machine.snapshot?.workspaces ?? []).map((workspace) => ({
			machine: machine.id,
			id: workspace.workspace_id,
			label: workspace.label,
		})),
	);
	return {
		profiles: Object.fromEntries(
			[...profiles].map(([name, profile]) => [name, profile.description]),
		),
		machines: machines.map(
			({
				snapshot: _snapshot,
				monitoredPaneIds: _monitoredPaneIds,
				...machine
			}) => machine,
		),
		agents: agents.slice(0, MAX_LIST_ITEMS),
		workspaces: workspaces.slice(0, MAX_LIST_ITEMS),
		...(agents.length > MAX_LIST_ITEMS
			? { moreAgents: agents.length - MAX_LIST_ITEMS }
			: {}),
		...(workspaces.length > MAX_LIST_ITEMS
			? { moreWorkspaces: workspaces.length - MAX_LIST_ITEMS }
			: {}),
	};
}

export async function findFleetAgents(
	fleet: AgentFleet,
	params: Pick<AgentsParams, "machine" | "query" | "status">,
): Promise<Record<string, unknown>> {
	const listed = await listFleetAgents(fleet, params);
	return {
		agents: listed["agents"],
		...(listed["moreAgents"] === undefined
			? {}
			: { moreAgents: listed["moreAgents"] }),
	};
}

export async function readAgentTerminal(
	runtime: ConnectedMachine,
	panel: PaneInfo,
	source: Exclude<(typeof READ_SOURCES)[number], "latest">,
	lines: number,
): Promise<Record<string, unknown>> {
	const value = await runtime.client.request<unknown>("agent.read", {
		target: panel.pane_id,
		source,
		format: "text",
		lines,
		strip_ansi: true,
	});
	if (
		typeof value !== "object" ||
		value === null ||
		!("read" in value) ||
		typeof value.read !== "object" ||
		value.read === null ||
		!("text" in value.read) ||
		typeof value.read.text !== "string"
	) {
		throw new Error("Herdr agent.read returned no text");
	}
	const truncated = value.read.text.length > MAX_TERMINAL_READ_CHARS;
	return {
		machine: runtime.machine,
		target: panel.pane_id,
		status: panel.agent_status,
		text: truncated
			? `${value.read.text.slice(0, MAX_TERMINAL_READ_CHARS)}\n…`
			: value.read.text,
		...(truncated ||
		("truncated" in value.read && value.read.truncated === true)
			? { truncated: true }
			: {}),
	};
}
