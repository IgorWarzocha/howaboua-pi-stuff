import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { AgentsParams, READ_SOURCES } from "./agents-contract.js";
import type { AgentFleet, ConnectedMachine } from "./fleet.js";
import { getSnapshot } from "./herdr.js";
import { loadAgentProfiles } from "./profiles.js";
import type { ClaimedSettlement } from "./settlement.js";
import type { AgentStatus, PaneInfo, SessionSnapshot } from "./types.js";

const MAX_LIST_ITEMS = 30;
const MAX_TERMINAL_READ_CHARS = 36_000;

export function toolResult(value: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		details: value,
	};
}

export function reportProgress(
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
	message: string,
	details: Record<string, unknown>,
): void {
	onUpdate({
		content: [{ type: "text", text: message }],
		details,
	});
}

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
			send: "target message machine? blocking?",
			read: "target machine? source? lines?",
			answer: "target answers machine? blocking?",
		},
		rules: {
			target: "Use spawn/find target exactly",
			label: "2-3 words; tab/session",
			answers: "[{selections?:string[],other?:string,comment?:string}]",
			blocking:
				"true default; false only while continuing work; results push, never poll",
			prompt:
				"Only task + inaccessible context; no method/evidence/reporting boilerplate",
			reuse:
				"Reuse only same investigation; reviews independent; new scope = new agent",
			...(profiles.has("general")
				? {
						general:
							"Only when requested/orchestrating. Current repo: create + bootstrap worktree; pass cwd",
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
					machine.name,
					machine.monitoredPaneIds?.has(agent.pane_id) ?? false,
				),
			)
			.filter((agent) => matchesAgent(agent, params.query, params.status));
	});
	const workspaces = machines.flatMap((machine) =>
		(machine.snapshot?.workspaces ?? []).map((workspace) => ({
			machine: machine.name,
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

function slugify(value: string): string {
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	const named = /^[a-z]/u.test(slug) ? slug : `agent-${slug}`;
	return named.slice(0, 32).replace(/-+$/u, "") || "agent";
}

export async function allocateAgentName(
	runtime: ConnectedMachine,
	label: string,
): Promise<string> {
	const snapshot = await getSnapshot(runtime.client);
	const names = new Set(
		snapshot.agents.map((agent) => agent.name).filter(Boolean),
	);
	const base = slugify(label);
	if (!names.has(base)) return base;
	for (let suffix = 2; suffix < 10_000; suffix += 1) {
		const tail = `-${suffix}`;
		const candidate = `${base.slice(0, 32 - tail.length).replace(/-+$/u, "")}${tail}`;
		if (!names.has(candidate)) return candidate;
	}
	throw new Error(
		`could not allocate an agent name for ${JSON.stringify(label)}`,
	);
}

export function settlementResult(
	machine: string,
	settlement: ClaimedSettlement,
): Record<string, unknown> {
	if (settlement.reply?.stopReason === "error") {
		throw new Error(
			settlement.reply.text ||
				`${settlement.agent.pane_id} assistant stopped with an error`,
		);
	}
	return {
		machine,
		target: settlement.agent.pane_id,
		...(settlement.agent.name ? { name: settlement.agent.name } : {}),
		status: settlement.status,
		...(settlement.reply ? { reply: settlement.reply.text } : {}),
		...(settlement.ask
			? {
					ask: {
						handoff: settlement.ask.handoff,
						prompts: settlement.ask.prompts.map((prompt) => ({
							title: prompt.title,
							multiple: prompt.multiple,
							choices: prompt.choices,
							...(prompt.body ? { body: prompt.body } : {}),
						})),
					},
				}
			: {}),
		...(settlement.blockedMessage
			? { blocked_on: settlement.blockedMessage }
			: {}),
		...(!settlement.reply && !settlement.ask ? { completed: true } : {}),
	};
}

export async function dispatchAgentWork(
	runtime: ConnectedMachine,
	panel: PaneInfo,
	task: string,
	blocking: boolean,
	signal: AbortSignal,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
	send: () => Promise<void>,
	options: { expectUserMessage?: boolean } = {},
): Promise<ClaimedSettlement | undefined> {
	signal.throwIfAborted();
	const baseline = options.expectUserMessage
		? await runtime.monitor.view(panel)
		: undefined;
	const attempt = runtime.monitor.beginWork(
		panel.pane_id,
		task,
		options.expectUserMessage ? (baseline?.user?.id ?? null) : undefined,
	);
	if (!attempt) throw new Error(`${panel.pane_id} is not monitored`);
	let settlement: Promise<ClaimedSettlement> | undefined;
	let sendStarted = false;
	try {
		settlement = blocking
			? runtime.monitor.claimWork(attempt, signal)
			: undefined;
		void settlement?.catch(() => undefined);
		signal.throwIfAborted();
		sendStarted = true;
		await send();
		runtime.monitor.acceptWork(attempt);
	} catch (error) {
		runtime.monitor.releaseWorkClaim(attempt, error);
		if (sendStarted) await runtime.monitor.handleWorkFailure(attempt, error);
		else runtime.monitor.rejectWork(attempt);
		throw error;
	}
	if (!blocking) return undefined;
	reportProgress(onUpdate, `Waiting for ${panel.name ?? panel.pane_id}`, {
		machine: runtime.machine,
		target: panel.pane_id,
		status: "working",
	});
	return await settlement!;
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
