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
	gpt = false,
): Promise<Record<string, unknown>> {
	const profiles = await loadAgentProfiles();
	return {
		commands: gpt
			? "commands:true lists slash commands+descriptions; target with optional machine→another session"
			: "commands:true lists this session's slash commands and descriptions. Supply target and optionally machine for another session.",
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
			peers: gpt
				? "Existing sessions may be independent peers; send/watch leave Notes/Board access unchanged"
				: "Existing sessions may be independent peers. You can send or watch without attaching or changing shared Notes or Board access.",
			read: gpt
				? "latest(default)=last reply+pending extension messages; visible=current TUI screen; recent=TUI scrollback, lines default 40. Findings→returned Notes path if shared Notes available"
				: "latest (default) returns the last reply and pending extension messages; visible reads the current TUI screen; recent reads TUI scrollback, lines default 40. For findings, read the returned Notes path when shared Notes is available",
			reply: gpt
				? "MUST use extension report/read template via reply, not send. Returns on acceptance without waiting for resumed work"
				: "To resolve an extension request, use its report or read template with reply. The call returns on acceptance without waiting for resumed work.",
			machine: gpt
				? "Use list id or unique label; local or omitted→Pi host; list/find omitted→all"
				: "Use an id or unique label from list. Use local or omit machine for the host running Pi. Omit machine from list or find for all machines.",
			target: gpt
				? "target=Pi session reference or terminal; /root=live spawn root"
				: "Use the Pi session reference or terminal target; /root selects the live root of saved spawn ancestry",
			resume: gpt
				? "send/assign to owned closed worker→resume saved session; restore reporting unless unwatched"
				: "Sending or assigning to an owned closed worker resumes its saved session and restores reporting unless unwatched.",
			label: "Short Pi session name; app tabs use default names",
			placement:
				"terminal (default), new_tab, new_workspace; new_tab needs space ID",
			...(boardAvailable
				? {
						board_thread_id: gpt
							? "Existing board thread→child read ref"
							: "Existing shared-board thread; child receives a read reference",
					}
				: {}),
			send: gpt
				? "Wakes idle agents; only concrete blocker, ownership conflict or actionable handoff. Skip acknowledgements, status-only updates and standby reminders"
				: "Messages wake idle agents. Send only a concrete blocker, ownership conflict or usable handoff that changes the recipient's next action. Skip acknowledgements, status-only updates and standby reminders.",
			assign: gpt
				? "Delegate/update work; active update shares pending result and preserves existing wait"
				: "Delegate or update work. Updating active work shares its pending result and preserves the existing wait.",
			focus: gpt
				? "Running session; passive arrival+return call, no task/watch. voice:true→async active mic transfer; handoff=context; remote focus stays on target host"
				: "Focus a running session on its host. It gets a passive arrival with a return call and optional handoff context, not a task or watch. voice:true also transfers the active microphone asynchronously.",
			sharing: boardAvailable
				? gpt
					? "attach/detach require idle target. Select scope: context:true for Notes/history, board:true for board membership, or both"
					: "The target MUST be idle for attach or detach. Select what changes: context:true for Notes and history, board:true for board membership, or both."
				: gpt
					? "attach/detach require idle target + context:true for Notes/history; boards unavailable"
					: "The target MUST be idle for attach or detach. Select Notes and history with context:true. Boards are unavailable.",
			attach: "Changes sharing only, without assigning or watching",
			detach: "Counterpart checkpoints remain read-only",
			blocking: gpt
				? "spawn/assign default→return on dispatch; blocking:true→wait; profile overrides spawn. Reports automatic→other work/end turn; MUST NOT poll"
				: "spawn and assign return after dispatch by default. Set blocking:true to wait for the result. Spawn profiles can override it. Background reports arrive automatically; do other work or end the turn instead of polling.",
			share_context: gpt
				? "Profile false→isolated notes/history; otherwise→controller sharing setting"
				: "Profile false isolates notes/history; otherwise follows controller sharing setting",
			watch: gpt
				? "Delegation/watch→report subsequent work UNTIL unwatch/close"
				: "Delegation and watch keep reporting subsequent work until unwatch or close",
			prompt: gpt
				? "Task + done criteria + needed context. Give real constraints; let the worker choose how. Assign shared work once. Redirecting? Keep the original task covered"
				: "State the task, what counts as done, and any context or constraints. Leave the approach to the worker. Assign shared work once. If you redirect a worker, keep its original task covered.",
			slash: gpt
				? "Leading /→target command/skill/template; bypasses task waits even via assign/spawn; blocked→choices. Close Pi+terminal via send /quit directly; no advance message, wait/watch or resume"
				: "A leading / routes to a target command, skill or template. Commands bypass task waits even with assign or spawn; blocked commands return available choices. To close Pi and its terminal, send /quit directly without a preceding message, wait or watch. /quit never resumes a closed worker.",
			reuse: gpt
				? "Keep each agent until task verified complete; corrections→same agent; then close. Unrelated task→new agent; reviews independent"
				: "Keep each agent available until its task is verified complete; return corrections to it before closing. Use separate agents for unrelated work and independent reviews.",
			...(profiles.has("general")
				? {
						general: "Only when requested/orchestrating",
					}
				: {}),
		},
		profiles: describeProfiles(profiles),
		advanced: "hc --skill: non-agent processes and machines",
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
