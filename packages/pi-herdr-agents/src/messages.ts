import {
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
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

interface AgentEventLabels {
	tab?: string;
	workspace?: string;
}

interface AgentEventOptions {
	agent: PaneInfo;
	blockedMessage?: string;
	labels: AgentEventLabels;
	record: MonitoredAgent;
	reply?: LatestAssistant;
	status: AgentStatus;
}

interface AgentEventDetails {
	blockedOn?: string;
	cwd?: string;
	name?: string;
	paneId: string;
	response?: string;
	state: "blocked" | "finished";
	tab?: string;
	task?: string;
	workspace?: string;
}

function operatorHint(paneId: string): string {
	return `Inspect first with \`herdr agent read ${paneId} --source visible\`; respond with \`herdr agent prompt ${paneId} "<text>"\` or use \`herdr pane send-keys ${paneId} <keys>\` for interactive controls.`;
}

function agentEvent(options: AgentEventOptions): {
	content: string;
	details: AgentEventDetails;
} {
	const { agent, blockedMessage, labels, record, reply, status } = options;
	const blocked = status === "blocked";
	const cwd = agent.foreground_cwd ?? agent.cwd ?? record.cwd;
	const tag = blocked ? "herdr_agent_blocked" : "herdr_agent_result";
	const attributes = [
		`pane="${xml(agent.pane_id)}"`,
		record.name ? `name="${xml(record.name)}"` : undefined,
		cwd ? `directory="${xml(cwd)}"` : undefined,
	]
		.filter(Boolean)
		.join(" ");
	const lines = [`<${tag} ${attributes}>`];
	if (record.task) lines.push(`<task>${xml(record.task)}</task>`);
	if (blockedMessage) {
		lines.push(`<blocked_on>${xml(blockedMessage)}</blocked_on>`);
	}
	if (blocked) {
		lines.push(
			`<operator_hint>${xml(operatorHint(agent.pane_id))}</operator_hint>`,
		);
	}
	if (reply) lines.push(`<response>${xml(reply.text)}</response>`);
	lines.push(`</${tag}>`);

	return {
		content: lines.join("\n"),
		details: {
			paneId: agent.pane_id,
			state: blocked ? "blocked" : "finished",
			...(record.name ? { name: record.name } : {}),
			...(cwd ? { cwd } : {}),
			...(labels.workspace ? { workspace: labels.workspace } : {}),
			...(labels.tab ? { tab: labels.tab } : {}),
			...(record.task ? { task: record.task } : {}),
			...(blockedMessage ? { blockedOn: blockedMessage } : {}),
			...(reply ? { response: reply.text } : {}),
		},
	};
}

export function injectAgentEvent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: AgentEventOptions,
): void {
	const message = agentEvent(options);
	pi.sendMessage(
		{
			customType: AGENT_EVENT_MESSAGE_TYPE,
			content: message.content,
			details: message.details,
			display: true,
		},
		ctx.isIdle() ? { triggerTurn: true } : { deliverAs: "followUp" },
	);
}

export function registerAgentEventRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<AgentEventDetails>(
		AGENT_EVENT_MESSAGE_TYPE,
		(message, { expanded, outputPad }, theme) => {
			const details = message.details;
			const blocked = details?.state === "blocked";
			const identity = details?.name
				? `${details.name} (${details.paneId})`
				: (details?.paneId ?? "unknown");
			const title = theme.fg(
				blocked ? "error" : "success",
				`Herdr agent ${identity} · ${blocked ? "blocked" : "finished"}`,
			);
			const location = [details?.workspace, details?.tab]
				.filter(Boolean)
				.join(" / ");
			const metadata = [location, details?.cwd].filter(Boolean).join(" · ");
			const box = new Box(outputPad, 1, (value) =>
				theme.bg("customMessageBg", value),
			);
			box.addChild(new Text(title, 0, 0));
			if (metadata) box.addChild(new Text(theme.fg("dim", metadata), 0, 0));
			if (blocked) {
				box.addChild(new Spacer(1));
				box.addChild(
					new Text(
						theme.fg(
							"warning",
							details?.blockedOn ?? "Agent needs input or approval",
						),
						0,
						0,
					),
				);
			}
			if (expanded && details?.task) {
				box.addChild(new Spacer(1));
				box.addChild(new Text(theme.fg("muted", "Task"), 0, 0));
				box.addChild(new Markdown(details.task, 0, 0, getMarkdownTheme()));
			}
			if (details?.response) {
				box.addChild(new Spacer(1));
				box.addChild(new Text(theme.fg("muted", "Response"), 0, 0));
				box.addChild(new Markdown(details.response, 0, 0, getMarkdownTheme()));
			}
			return box;
		},
	);
}
