import type { AgentsParams, READ_SOURCES } from "./agents-contract.js";
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
			? "commands:true lists slash commands/descriptions, NEVER executes; default=this session; target/machine→another"
			: "commands: true lists available slash commands with descriptions; defaults to this session, target and machine optionally select another session; does not execute commands",
		actions: {
			help: "",
			list: "machine?",
			find: "query? status? machine?",
			focus: "target machine? voice? handoff?",
			spawn:
				"agent_type label message name? machine? placement? workspace? pane? cwd? base? blocking?" +
				(boardAvailable ? " board_thread_id?" : ""),
			watch: "target machine?",
			unwatch: "target machine?",
			send: "target message machine?",
			assign: "target message machine? blocking?",
			attach: "target context board machine?",
			detach: "target context board machine?",
			read: "target machine? source=latest|visible|recent? lines?",
			reply: "target extension id message machine?",
		},
		rules: {
			reply: gpt
				? "Extension report/read template required; send≠resolve; blocking waits resumed work; others return after semantic delivery"
				: "Use the extension-authored template from its report/read; send does not resolve it. Blocking messages wait for resumed work; other replies return after semantic delivery",
			machine: gpt
				? "machine omitted=local Pi host; list/find omitted=all machines; remote=list profile ID, NOT label/hostname"
				: "Omit for local (host running Pi); list/find omit for all machines. Remote: profile ID from list, not label/hostname",
			target: gpt
				? "spawn/find target EXACT; /root=this family live root"
				: "Use spawn/find target exactly; /root selects this family's live root",
			label: gpt
				? "Short tab/session name; two words IF useful"
				: "Short tab/session name; prefer two words when useful",
			...(boardAvailable
				? {
						board_thread_id: gpt
							? "Existing board thread→child read ref"
							: "Existing shared-board thread; child receives a read reference",
					}
				: {}),
			send: gpt
				? "/quit next→NO preceding message; sends wake idle agents; NO wait/watch"
				: "When closing an agent, send /quit without another message first. Messages wake idle agents. No waiting or watching.",
			assign: gpt
				? "Delegate/update work; active→share pending result, NEVER replace wait"
				: "Delegate or update work; active updates share its pending result, never replace an existing wait",
			focus: gpt
				? "Running session; passive arrival+return call, NO task/watch; voice default false, true=async active mic transfer; handoff=context; remote=target Herdr session≠client machine"
				: "Select a running session; passive arrival with return call, no task/watch. voice defaults false; true carries the active microphone asynchronously. handoff adds context. Remote focus selects the target's Herdr session, not the client's machine",
			attach: boardAvailable
				? gpt
					? "Idle target; context/board=independent sharing/membership; NO task/watch"
					: "Idle target; context/board booleans choose shared access and board membership independently; no task/watch"
				: gpt
					? "Idle target; context=shared notes/history; boards unavailable→board:false; NO task/watch"
					: "Idle target; context shares notes/history; use board:false while shared boards are unavailable; no task/watch",
			detach: gpt
				? "Idle target; stop selected membership; counterpart checkpoints remain readonly"
				: "Stop selected membership; retain counterpart checkpoints read-only; idle target",
			blocking: gpt
				? "spawn/assign default true; profile overrides spawn; JS parallel+wait: await Promise.allSettled; false ONLY if other work continues; completion/blockage AFTER reply; NO poll/sleep"
				: "spawn/assign default true; profile blocking overrides spawn. In JavaScript cells, use await Promise.allSettled for parallel calls that wait for every result, including failures. Use false only to continue other work; completion/blockage arrives after your reply. No polling or sleep waits",
			share_context: gpt
				? "Profile false→isolated notes/history; otherwise→controller sharing setting"
				: "Profile false isolates notes/history; otherwise follows controller sharing setting",
			watch: gpt
				? "Delegation/watch→report subsequent work UNTIL unwatch/close"
				: "Delegation and watch keep reporting subsequent work until unwatch or close",
			prompt: gpt
				? "Distinct scope/outcome/project context/issue refs; define success, NOT forbidden investigations"
				: "Give each worker a distinct scope, desired outcome, relevant project context and issue references. Describe success rather than lists of forbidden investigations",
			slash: gpt
				? "Leading / routes target commands/skills/templates; commands skip task wait EVEN assign/spawn; blocked→choices; /quit exits Pi+closes pane"
				: "Leading / routes target commands/skills/templates. Commands skip task waiting, even with assign/spawn; blocked commands return available choices. /quit shuts down Pi and closes its pane",
			reuse: gpt
				? "Reuse ONLY same investigation; reviews independent; new scope=new agent"
				: "Reuse only same investigation; reviews independent; new scope = new agent",
			...(profiles.has("general")
				? {
						general: "Only when requested/orchestrating",
					}
				: {}),
		},
		profiles: describeProfiles(profiles),
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
		profiles: describeProfiles(profiles),
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
