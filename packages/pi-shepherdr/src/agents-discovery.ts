import { nativeAgentName } from "./agent-identity.js";
import type { AgentsParams, READ_SOURCES } from "./agents-contract.js";
import { readTerminal } from "./core/agents.js";
import type { AgentFleet, ConnectedMachine } from "./fleet/index.js";
import { type AgentProfile, loadAgentProfiles } from "./profiles.js";
import type { AgentStatus, PaneInfo, SessionSnapshot } from "./types.js";

const MAX_LIST_ITEMS = 30;
const MAX_TERMINAL_READ_CHARS = 36_000;

function describeProfiles(profiles: Map<string, AgentProfile>) {
	return Object.fromEntries(
		[...profiles].map(([name, profile]) => [
			name,
			{
				description: profile.description,
				...(profile.blocking === undefined
					? {}
					: { blocking: profile.blocking }),
				...(profile.shareContext === undefined
					? {}
					: { share_context: profile.shareContext }),
			},
		]),
	);
}

export async function agentsHelp(
	boardAvailable = false,
): Promise<Record<string, unknown>> {
	const profiles = await loadAgentProfiles();
	return {
		commands:
			"commands:true lists slash commands+descriptions; target with optional machine→another session",
		actions: {
			help: "",
			list: "machine?",
			find: "query? status? machine?",
			focus:
				"target machine? voice? handoff? → move to a running session without assigning work",
			spawn:
				"agent_type label message name? machine? placement? workspace? cwd? base? blocking?" +
				(boardAvailable ? " board_thread_id?" : ""),
			send: "target message|task wait?: true (task only) machine?",
			watch: "target enabled: true|false machine?",
			sharing: boardAvailable
				? "target operation: attach|detach scope: context|board|both machine?"
				: "target operation: attach|detach scope: context machine?",
			read: "target machine? source=latest|visible|recent? lines?",
			reply: "target extension id message machine?",
		},
		rules: {
			read: "latest (default): last reply and pending extension messages. visible: screen. recent: scrollback. Use returned Notes path for shared findings",
			reply:
				"MUST use extension report/read template via reply, not send. Returns on acceptance without waiting for resumed work",
			machine:
				"Use list id or unique label; local or omitted→current host; list/find omitted→all",
			target:
				"target=agent session reference or terminal address; /root=live spawn root",
			resume:
				"send to owned closed worker→resume saved session; restore reporting unless disabled",
			placement:
				"terminal (default), new_tab, new_workspace; new_tab needs space ID",
			...(boardAvailable
				? {
						board_thread_id: "Existing board thread→child read ref",
					}
				: {}),
			send: "message → blocker, ownership conflict or actionable handoff. No new supervision. Act first → report outcomes that affect peer work. Plans only for advance coordination. Skip acknowledgements, status-only updates, standby reminders. task → delegate and supervise. Active task → keep existing wait. Idle target → wake",
			focus: "voice:true transfers the mic. handoff supplies arrival context",
			sharing:
				"Idle target only. context → Notes/history. Context detach → read-only counterpart checkpoints",
			completion:
				"spawn blocking:true or send task wait:true → wait for outcome. Spawn profile can override. Otherwise return on dispatch → automatic report. MUST NOT poll",
			watch:
				"Spawn, delegate or enabled:true → report subsequent work until disabled or closed. enabled:false → stop reports, not work",
			slash:
				"Leading / runs a target command without waiting for task completion. Close a finished worker with send /quit",
			reuse:
				"Keep each agent until task verified complete; corrections→same agent; then close. Unrelated task→new agent; reviews independent",
			...(profiles.has("general")
				? { general: "Only when requested or orchestrating" }
				: {}),
		},
		profiles: describeProfiles(profiles),
		advanced: {
			agents:
				"MUST use agents for supported Pi agent operations, even when the Herdr manuals show CLI alternatives.",
			core: "Non-agent processes and persistent terminals, remote commands and files, machine setup → hc --skill",
			core_background:
				"hc run --bg → parent exit note unless notes off or --no-notify. Other work or end turn. No sleep, hc get/read loops or log checks for exit. hc wait only if exit/readiness blocks progress or needed result won't arrive by note.",
			app: "Window layout (spaces, tabs, panes) → herdr-app --skill",
		},
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
		...(agent.label || names.panes.get(agent.pane_id) || agent.title
			? { label: agent.label || names.panes.get(agent.pane_id) || agent.title }
			: {}),
		...(agent.title && (agent.label || names.panes.get(agent.pane_id))
			? { title: agent.title }
			: {}),
		status: agent.agent_status,
		cwd: agent.foreground_cwd ?? agent.cwd ?? null,
		...(agent.workspace_id
			? {
					workspace:
						names.workspaces.get(agent.workspace_id) ?? agent.workspace_id,
				}
			: {}),
		...(agent.tab_id
			? { tab: names.tabs.get(agent.tab_id) ?? agent.tab_id }
			: {}),
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
	const normalize = (value: string) =>
		value
			.toLowerCase()
			.replace(/[-_\s]+/g, " ")
			.trim();
	const needle = normalize(query);
	return Object.values(agent)
		.filter((value) => typeof value === "string")
		.some((value) => normalize(value).includes(needle));
}

export async function listFleetAgents(
	fleet: AgentFleet,
	params: Pick<AgentsParams, "machine" | "query" | "status">,
): Promise<Record<string, unknown>> {
	const [profiles, machines] = await Promise.all([
		loadAgentProfiles(),
		fleet.snapshots(params.machine),
	]);
	const agents = (
		await Promise.all(
			machines.map(async (machine) => {
				if (!machine.snapshot) return [];
				const runtime = fleet.connected(machine.id);
				return (
					await Promise.all(
						machine.snapshot.agents
							.filter(
								(agent) =>
									agent.agent === "pi" &&
									(!machine.local ||
										agent.terminal_id !== process.env["HC_TERMINAL_ID"]),
							)
							.map(async (agent) => {
								const result = compactAgent(
									agent,
									machine.snapshot!,
									machine.id,
									machine.monitoredPaneIds?.has(agent.pane_id) ?? false,
								);
								try {
									result["agent"] = await nativeAgentName(
										runtime.client,
										agent,
									);
								} catch {
									// Older or unavailable receivers remain addressable by their terminal.
									result["identityUnavailable"] = true;
								}
								return result;
							}),
					)
				).filter((agent) => matchesAgent(agent, params.query, params.status));
			}),
		)
	).flat();
	const workspaces = machines.flatMap((machine) =>
		(machine.snapshot?.workspaces ?? []).map((workspace) => ({
			machine: machine.id,
			id: workspace.workspace_id,
			label: workspace.label,
		})),
	);
	return {
		profiles: describeProfiles(profiles),
		machines: machines.map(
			({
				snapshot: _snapshot,
				monitoredPaneIds: _monitoredPaneIds,
				session: _session,
				target: _host,
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
	const value = await readTerminal(
		runtime.client,
		panel.terminal_id,
		source === "visible" ? 0 : lines,
	);
	const truncated = value.text.length > MAX_TERMINAL_READ_CHARS;
	return {
		machine: runtime.machine,
		target: panel.pane_id,
		status: panel.agent_status,
		text: truncated
			? `${value.text.slice(0, MAX_TERMINAL_READ_CHARS)}\n…`
			: value.text,
		...(truncated || value.truncated ? { truncated: true } : {}),
	};
}
