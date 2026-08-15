import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentFleet } from "./fleet.js";
import { resolvePiAgent } from "./herdr.js";
import {
	START_PLACEMENTS,
	type StartAgentParams,
	startAgent,
} from "./launch.js";
import type { AgentMonitor } from "./monitor.js";
import type { MonitoredAgent, PaneInfo, SessionSnapshot } from "./types.js";

const ACTIONS = ["list", "start", "watch", "unwatch", "send"] as const;
const FIRE_AND_FORGET =
	"Do not poll; completion or blockage will be delivered automatically";

type ToolParams = StartAgentParams & {
	action: (typeof ACTIONS)[number];
	machine?: string;
	target?: string;
};

function required(value: string | undefined, field: string): string {
	if (!value?.trim()) throw new Error(`${field} is required for this action`);
	return value.trim();
}

function result(value: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		details: value,
	};
}

function labels(snapshot: SessionSnapshot) {
	return {
		workspaces: new Map(
			snapshot.workspaces.map((workspace) => [
				workspace.workspace_id,
				workspace.label,
			]),
		),
		tabs: new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab.label])),
	};
}

function compactAgent(
	agent: PaneInfo,
	snapshot: SessionSnapshot,
	monitored: boolean,
	machine: string,
): Record<string, unknown> {
	const names = labels(snapshot);
	return {
		machine,
		id: agent.pane_id,
		...(agent.name ? { name: agent.name } : {}),
		status: agent.agent_status,
		cwd: agent.foreground_cwd ?? agent.cwd ?? null,
		workspace: names.workspaces.get(agent.workspace_id) ?? agent.workspace_id,
		workspaceId: agent.workspace_id,
		tab: names.tabs.get(agent.tab_id) ?? agent.tab_id,
		tabId: agent.tab_id,
		monitored,
	};
}

function findRecord(
	monitor: AgentMonitor,
	target: string,
): MonitoredAgent | undefined {
	const matches = monitor
		.list()
		.filter((agent) => agent.paneId === target || agent.name === target);
	if (matches.length > 1) {
		throw new Error(
			`monitored agent name ${JSON.stringify(target)} is ambiguous`,
		);
	}
	return matches[0];
}

export function registerHerdrAgentsTool(
	pi: ExtensionAPI,
	fleet: AgentFleet,
): void {
	pi.registerTool({
		name: "herdr_agents",
		label: "Shepherdr",
		description:
			"Herdr Pi agents across configured machines. start needs name and placement; new_tab needs workspace; pane placement needs pane ID. watch/unwatch need target; send needs target and prompt.",
		promptGuidelines: [
			"Act as an orchestrator: delegate project implementation, synthesize worker results, and report them to the user. Work directly only when explicitly asked or for configuration, documentation, and routine operations in the current working directory",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS),
			machine: Type.Optional(
				Type.String({ description: "Configured machine; defaults to local" }),
			),
			target: Type.Optional(
				Type.String({ description: "Agent name or pane ID" }),
			),
			name: Type.Optional(
				Type.String({
					description: "Agent name; [a-z][a-z0-9_-]{0,31}",
				}),
			),
			label: Type.Optional(
				Type.String({
					description:
						"Pi session label; also labels a new tab; defaults to name",
				}),
			),
			placement: Type.Optional(StringEnum(START_PLACEMENTS)),
			workspace: Type.Optional(
				Type.String({ description: "Workspace label or ID" }),
			),
			pane: Type.Optional(Type.String()),
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory for a new location; defaults to current",
				}),
			),
			prompt: Type.Optional(
				Type.String({
					description: "Initial task (start) or message (send)",
				}),
			),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx) {
			if (params.action === "list") {
				const machines = await fleet.snapshots(params.machine);
				return result({
					machines: machines.map(
						({ snapshot: _snapshot, ...machine }) => machine,
					),
					agents: machines.flatMap((machine) => {
						if (!machine.snapshot) return [];
						const runtime = fleet.connected(machine.name);
						return machine.snapshot.agents
							.filter(
								(agent) =>
									agent.agent === "pi" &&
									(!machine.local ||
										agent.pane_id !== process.env["HERDR_PANE_ID"]),
							)
							.map((agent) =>
								compactAgent(
									agent,
									machine.snapshot!,
									runtime.monitor.isMonitored(agent.pane_id),
									machine.name,
								),
							);
					}),
					workspaces: machines.flatMap((machine) =>
						(machine.snapshot?.workspaces ?? []).map((workspace) => ({
							machine: machine.name,
							id: workspace.workspace_id,
							label: workspace.label,
						})),
					),
				});
			}
			const runtime = fleet.connected(params.machine);
			const { client, machine, monitor } = runtime;
			if (params.action === "start") {
				const started = await startAgent(
					client,
					monitor,
					params,
					runtime.local ? ctx.cwd : runtime.fallbackCwd,
					runtime.resolveDirectory,
				);
				return result({
					started: true,
					machine,
					id: started.id,
					...(params.prompt?.trim() ? { next: FIRE_AND_FORGET } : {}),
				});
			}

			const target = required(params.target, "target");
			if (params.action === "unwatch") {
				const record = findRecord(monitor, target);
				if (!record) return result({ unwatched: false, machine, target });
				await monitor.unwatch(record.paneId);
				return result({ unwatched: true, machine, id: record.paneId });
			}

			const agent = await resolvePiAgent(
				client,
				target,
				runtime.local ? process.env["HERDR_PANE_ID"] : "",
			);
			if (params.action === "watch") {
				await monitor.watch(agent);
				return result({
					watched: true,
					machine,
					id: agent.pane_id,
					next: FIRE_AND_FORGET,
				});
			}
			if (params.action === "send") {
				const prompt = required(params.prompt, "prompt");
				if (!monitor.isMonitored(agent.pane_id)) await monitor.watch(agent);
				const attempt = monitor.beginWork(agent.pane_id, prompt);
				try {
					await client.request("agent.prompt", {
						target: agent.pane_id,
						text: prompt,
					});
					monitor.acceptWork(attempt);
				} catch (error) {
					await monitor.handleWorkFailure(attempt, error);
					throw error;
				}
				return result({
					sent: true,
					machine,
					id: agent.pane_id,
					next: FIRE_AND_FORGET,
				});
			}
			throw new Error(`unsupported action ${params.action}`);
		},
	});
}
