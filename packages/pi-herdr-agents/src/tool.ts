import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSnapshot, resolvePiAgent, sessionPath } from "./herdr.js";
import {
	START_PLACEMENTS,
	type StartAgentParams,
	startAgent,
} from "./launch.js";
import type { AgentMonitor } from "./monitor.js";
import { SessionReader } from "./session-reader.js";
import type { MonitoredAgent, PaneInfo, SessionSnapshot } from "./types.js";

const ACTIONS = [
	"list",
	"start",
	"adopt",
	"send",
	"read",
	"focus",
	"release",
	"close",
] as const;

type ToolParams = StartAgentParams & {
	action: (typeof ACTIONS)[number];
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
): Record<string, unknown> {
	const names = labels(snapshot);
	return {
		id: agent.pane_id,
		...(agent.name ? { name: agent.name } : {}),
		status: agent.agent_status,
		cwd: agent.foreground_cwd ?? agent.cwd ?? null,
		workspace: names.workspaces.get(agent.workspace_id) ?? agent.workspace_id,
		tab: names.tabs.get(agent.tab_id) ?? agent.tab_id,
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
	getMonitor: () => AgentMonitor,
): void {
	const reader = new SessionReader();
	pi.registerTool({
		name: "herdr_agents",
		label: "Herdr Agents",
		description:
			"Control and monitor Pi agents in Herdr. list discovers existing agents; start requires an explicit Herdr placement; adopt/release change monitoring only; send submits a follow-up and monitors its result.",
		promptSnippet: "Coordinate Pi agents running in Herdr.",
		promptGuidelines: [
			"herdr_agents: Use list before choosing existing layout or agents. Herdr restores sessions; send follow-ups instead of resuming them.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS),
			target: Type.Optional(Type.String()),
			name: Type.Optional(Type.String()),
			label: Type.Optional(Type.String()),
			placement: Type.Optional(StringEnum(START_PLACEMENTS)),
			workspace: Type.Optional(Type.String()),
			pane: Type.Optional(Type.String()),
			cwd: Type.Optional(Type.String()),
			prompt: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx) {
			const monitor = getMonitor();
			const client = monitor.client;
			if (params.action === "list") {
				const snapshot = await getSnapshot(client);
				return result({
					agents: snapshot.agents
						.filter(
							(agent) =>
								agent.agent === "pi" &&
								agent.pane_id !== process.env["HERDR_PANE_ID"],
						)
						.slice(0, 30)
						.map((agent) =>
							compactAgent(agent, snapshot, monitor.isMonitored(agent.pane_id)),
						),
					workspaces: snapshot.workspaces.slice(0, 50).map((workspace) => ({
						id: workspace.workspace_id,
						label: workspace.label,
					})),
				});
			}
			if (params.action === "start") {
				return result(await startAgent(client, monitor, params, ctx.cwd));
			}

			const target = required(params.target, "target");
			if (params.action === "release") {
				const record = findRecord(monitor, target);
				if (!record) return result({ released: false, target });
				await monitor.release(record.paneId);
				return result({ released: true, id: record.paneId });
			}
			if (params.action === "close") {
				const record = findRecord(monitor, target);
				const paneId =
					record?.paneId ?? (await resolvePiAgent(client, target)).pane_id;
				await client.request("pane.close", { pane_id: paneId });
				await monitor.release(paneId);
				return result({ closed: true, id: paneId });
			}

			const agent = await resolvePiAgent(client, target);
			if (params.action === "adopt") {
				await monitor.adopt(agent);
				return result({
					adopted: true,
					id: agent.pane_id,
					status: agent.agent_status,
				});
			}
			if (params.action === "send") {
				const prompt = required(params.prompt, "prompt");
				if (!monitor.isMonitored(agent.pane_id)) await monitor.adopt(agent);
				monitor.beginWork(agent.pane_id, prompt);
				try {
					await client.request("agent.prompt", {
						target: agent.pane_id,
						text: prompt,
					});
				} catch (error) {
					await monitor.reconcileNow().catch(() => undefined);
					throw error;
				}
				return result({ sent: true, id: agent.pane_id, monitored: true });
			}
			if (params.action === "read") {
				const reply = await reader.latest(sessionPath(agent));
				return result({
					id: agent.pane_id,
					status: agent.agent_status,
					text: reply?.text ?? null,
				});
			}
			if (params.action === "focus") {
				await client.request("agent.focus", { target: agent.pane_id });
				return result({ focused: true, id: agent.pane_id });
			}
			throw new Error(`unsupported action ${params.action}`);
		},
	});
}
