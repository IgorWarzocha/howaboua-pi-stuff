import { basename } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentStatus,
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
} from "./types.js";

const AGENT_EVENT_MESSAGE_TYPE = "herdr-agent-event";

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function sessionLabel(agent: PaneInfo): string | undefined {
	const session = agent.agent_session;
	if (!session) return undefined;
	return session.kind === "path" ? basename(session.value) : session.value;
}

export interface AgentEventLabels {
	tab?: string;
	workspace?: string;
}

export function agentEventContent(options: {
	agent: PaneInfo;
	blockedMessage?: string;
	labels: AgentEventLabels;
	record: MonitoredAgent;
	reply?: LatestAssistant;
	status: AgentStatus;
}): string {
	const { agent, blockedMessage, labels, record, reply, status } = options;
	const attributes = [
		`status="${status}"`,
		`pane="${xml(agent.pane_id)}"`,
		record.name ? `name="${xml(record.name)}"` : undefined,
	]
		.filter(Boolean)
		.join(" ");
	const lines = [`<herdr_agent_event ${attributes}>`];
	if (labels.workspace) {
		lines.push(
			`<workspace id="${xml(agent.workspace_id)}">${xml(labels.workspace)}</workspace>`,
		);
	}
	if (labels.tab) {
		lines.push(`<tab id="${xml(agent.tab_id)}">${xml(labels.tab)}</tab>`);
	}
	const cwd = agent.foreground_cwd ?? agent.cwd ?? record.cwd;
	if (cwd) lines.push(`<directory>${xml(cwd)}</directory>`);
	const session = sessionLabel(agent);
	if (session) lines.push(`<session>${xml(session)}</session>`);
	if (record.task) {
		lines.push(`<task>${xml(record.task)}</task>`);
	}
	if (blockedMessage)
		lines.push(`<blocked_on>${xml(blockedMessage)}</blocked_on>`);
	if (reply) {
		lines.push(`<assistant_message>${xml(reply.text)}</assistant_message>`);
	}
	lines.push("</herdr_agent_event>");
	return lines.join("\n");
}

export function injectAgentEvent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	content: string,
	details: Record<string, unknown>,
): void {
	pi.sendMessage(
		{
			customType: AGENT_EVENT_MESSAGE_TYPE,
			content,
			details,
			display: true,
		},
		ctx.isIdle() ? { triggerTurn: true } : { deliverAs: "followUp" },
	);
}
