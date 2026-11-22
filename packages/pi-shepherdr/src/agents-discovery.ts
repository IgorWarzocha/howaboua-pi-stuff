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
			focus: "target machine? voice? handoff?",
			spawn:
				"agent_type label message name? machine? placement? workspace? cwd? base? blocking?" +
				(boardAvailable ? " board_thread_id?" : ""),
			watch: "target machine?",
			unwatch: "target machine?",
			send: "target message machine?",
			assign: "target message machine? blocking?",
			attach: "target context? board? machine?",
			detach: "target context? board? machine?",
			read: "target machine? source=latest|visible|recent? lines?",
			reply: "target extension id message machine?",
		},
		rules: {
			peers:
				"Existing sessions may be independent peers; send/watch leave Notes/Board access unchanged",
			read: "latest(default)=last reply+pending extension messages; visible=current TUI screen; recent=TUI scrollback, lines default 40. Findings→returned Notes path if shared Notes available",
			reply:
				"MUST use extension report/read template via reply, not send. Returns on acceptance without waiting for resumed work",
			machine:
				"Use list id or unique label; local or omitted→Pi host; list/find omitted→all",
			target: "target=Pi session reference or terminal; /root=live spawn root",
			resume:
				"send/assign to owned closed worker→resume saved session; restore reporting unless unwatched",
			label: "Short Pi session name; app tabs use default names",
			placement:
				"terminal (default), new_tab, new_workspace; new_tab needs space ID",
			...(boardAvailable
				? {
						board_thread_id: "Existing board thread→child read ref",
					}
				: {}),
			send: "Wakes idle agents; only concrete blocker, ownership conflict or actionable handoff. Skip acknowledgements, status-only updates and standby reminders",
			assign:
				"Delegate/update work; active update shares pending result and preserves existing wait",
			focus:
				"Running session; passive arrival+return call, no task/watch. voice:true→async active mic transfer; handoff=context; remote focus stays on target host",
			sharing: boardAvailable
				? "attach/detach require idle target. Select scope: context:true for Notes/history, board:true for board membership, or both"
				: "attach/detach require idle target + context:true for Notes/history; boards unavailable",
			attach: "Changes sharing only, without assigning or watching",
			detach: "Counterpart checkpoints remain read-only",
			blocking:
				"spawn/assign default→return on dispatch; blocking:true→wait; profile overrides spawn. Reports automatic→other work/end turn; MUST NOT poll",
			share_context:
				"Profile false→isolated notes/history; otherwise→controller sharing setting",
			watch: "Delegation/watch→report subsequent work UNTIL unwatch/close",
			prompt:
				"Task + done criteria + needed context. Give real constraints; let the worker choose how. Assign shared work once. Redirecting? Keep the original task covered",
			slash:
				"Leading /→target command/skill/template; bypasses task waits even via assign/spawn; blocked→choices. Close Pi+terminal via send /quit directly; no advance message, wait/watch or resume",
			reuse:
				"Keep each agent until task verified complete; corrections→same agent; then close. Unrelated task→new agent; reviews independent",
			...(profiles.has("general")
				? {
						general: "Only when requested/orchestrating",
					}
				: {}),
		},
		profiles: describeProfiles(profiles),
		advanced: {
			core: "Non-agent processes, persistent terminals, remote machines→read hc --skill",
			app: "Change what the user sees (spaces/tabs/panes)→herdr-app --skill",
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
