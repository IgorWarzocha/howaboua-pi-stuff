import {
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { activityTask } from "./activity.js";
import type {
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
	SettledAgentStatus,
} from "./types.js";

const AGENT_EVENT_MESSAGE_TYPE = "herdr-agent-event";
const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";

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
	status: SettledAgentStatus;
}

interface AgentEventDetails {
	blockedOn?: string;
	cwd?: string;
	name?: string;
	paneId: string;
	response?: string;
	state: "blocked" | "failed" | "finished";
	tab?: string;
	task?: string;
	workspace?: string;
}

function voiceDetail(
	value: string | undefined,
	maxBytes: number,
): string | undefined {
	const text = value?.trim();
	if (!text || new TextEncoder().encode(text).byteLength > maxBytes)
		return undefined;
	return JSON.stringify(text);
}

function agentVoicePrompt(details: AgentEventDetails): string {
	const name = voiceDetail(details.name, 160);
	const identity = name ? `The monitored worker ${name}` : "A monitored worker";
	const instruction = "Please announce this briefly in your natural voice.";
	if (details.state === "blocked") {
		const reason = voiceDetail(details.blockedOn, 512);
		return `${identity} is blocked${reason ? `: ${reason}` : ""}. User attention may be required. ${instruction}`;
	}
	return details.state === "failed"
		? `${identity} has failed its assigned work. ${instruction}`
		: `${identity} has finished its assigned work. ${instruction}`;
}

function announceAgentEvent(
	pi: ExtensionAPI,
	details: AgentEventDetails,
): void {
	const candidateId = `pi-shepherdr:${details.paneId}`;
	const id =
		new TextEncoder().encode(candidateId).byteLength <= 160
			? candidateId
			: "pi-shepherdr:worker";
	const prompt = agentVoicePrompt(details);
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: true, prompt });
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: false, prompt });
}

function operatorHint(paneId: string): string {
	return `Inspect first with \`herdr agent read ${paneId} --source visible\`; respond with \`herdr agent prompt ${paneId} "<text>"\` or use \`herdr agent send-keys ${paneId} <keys>\` for interactive controls.`;
}

function eventDetails(value: unknown): AgentEventDetails | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const details = value as Record<string, unknown>;
	if (
		typeof details["paneId"] !== "string" ||
		(details["state"] !== "blocked" &&
			details["state"] !== "failed" &&
			details["state"] !== "finished")
	) {
		return undefined;
	}
	const optional = (field: keyof AgentEventDetails) =>
		typeof details[field] === "string"
			? { [field]: details[field] as string }
			: {};
	return {
		paneId: details["paneId"],
		state: details["state"],
		...optional("blockedOn"),
		...optional("cwd"),
		...optional("name"),
		...optional("response"),
		...optional("tab"),
		...optional("task"),
		...optional("workspace"),
	};
}

function agentEvent(options: AgentEventOptions): {
	content: string;
	details: AgentEventDetails;
} {
	const { agent, blockedMessage, labels, record, reply, status } = options;
	const task = activityTask(record.activity);
	const blocked = status === "blocked";
	const failed = !blocked && reply?.stopReason === "error";
	const cwd = agent.foreground_cwd ?? agent.cwd ?? record.cwd;
	const tag = blocked
		? "herdr_agent_blocked"
		: failed
			? "herdr_agent_failed"
			: "herdr_agent_result";
	const attributes = [
		`pane="${xml(agent.pane_id)}"`,
		record.name ? `name="${xml(record.name)}"` : undefined,
		cwd ? `directory="${xml(cwd)}"` : undefined,
	]
		.filter(Boolean)
		.join(" ");
	const lines = [`<${tag} ${attributes}>`];
	if (task) lines.push(`<task>${xml(task)}</task>`);
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
			state: blocked ? "blocked" : failed ? "failed" : "finished",
			...(record.name ? { name: record.name } : {}),
			...(cwd ? { cwd } : {}),
			...(labels.workspace ? { workspace: labels.workspace } : {}),
			...(labels.tab ? { tab: labels.tab } : {}),
			...(task ? { task } : {}),
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
	const delivery = ctx.isIdle()
		? { triggerTurn: true, deliverAs: "steer" as const }
		: { deliverAs: "steer" as const };
	pi.sendMessage(
		{
			customType: AGENT_EVENT_MESSAGE_TYPE,
			content: message.content,
			details: message.details,
			display: true,
		},
		delivery,
	);
	announceAgentEvent(pi, message.details);
}

export function registerAgentEventRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<AgentEventDetails>(
		AGENT_EVENT_MESSAGE_TYPE,
		(message, { expanded, outputPad }, theme) => {
			const details = eventDetails(message.details);
			if (!details) {
				const box = new Box(outputPad, 1, (value) =>
					theme.bg("customMessageBg", value),
				);
				box.addChild(
					new Text(
						typeof message.content === "string"
							? message.content
							: "Herdr agent event unavailable",
						0,
						0,
					),
				);
				return box;
			}
			const blocked = details?.state === "blocked";
			const failed = details?.state === "failed";
			const identity = details?.name
				? `${details.name} (${details.paneId})`
				: (details?.paneId ?? "unknown");
			const title = theme.fg(
				blocked || failed ? "error" : "success",
				`Herdr agent ${identity} · ${blocked ? "blocked" : failed ? "failed" : "finished"}`,
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
