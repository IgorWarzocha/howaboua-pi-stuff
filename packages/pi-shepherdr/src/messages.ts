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
const MAX_REALTIME_VOICE_PROMPT_BYTES = 4 * 1_024;

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

function boundedVoicePrompt(prompt: string, truncationNotice: string): string {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(prompt);
	if (bytes.byteLength <= MAX_REALTIME_VOICE_PROMPT_BYTES) return prompt;

	const suffix = `…\n\n${truncationNotice}`;
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let end = MAX_REALTIME_VOICE_PROMPT_BYTES - encoder.encode(suffix).byteLength;
	while (end > 0) {
		try {
			return `${decoder.decode(bytes.subarray(0, end)).trimEnd()}${suffix}`;
		} catch {
			end -= 1;
		}
	}
	return truncationNotice;
}

function agentVoicePrompt(details: AgentEventDetails): string {
	const lines = [
		`Worker: ${details.name?.trim() || "unnamed"}`,
		`State: ${details.state}`,
	];
	if (details.task?.trim()) lines.push(`Task:\n${details.task.trim()}`);
	let instruction: string;
	let truncationNotice: string;
	if (details.state === "blocked") {
		instruction =
			"Briefly tell the user why this monitored worker is blocked and what attention may be required.";
		truncationNotice =
			"The blocked worker details above were truncated. Tell the user and ask whether they would like the rest.";
		if (details.blockedOn?.trim())
			lines.push(`Reason:\n${details.blockedOn.trim()}`);
	} else {
		instruction =
			details.state === "failed"
				? "Briefly tell the user that this monitored worker failed and include useful detail from its report."
				: "Briefly tell the user what this monitored worker found or completed; do not merely announce that it finished.";
		truncationNotice =
			"The worker report above was truncated. Tell the user and ask whether they would like the rest.";
		if (details.response?.trim())
			lines.push(`Report:\n${details.response.trim()}`);
	}
	return boundedVoicePrompt(
		`${instruction}\n\n${lines.join("\n\n")}`,
		truncationNotice,
	);
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

function blockedOperatorHint(paneId: string): string {
	return `Inspect first with \`herdr agent read ${paneId} --source visible\`; respond with \`herdr agent prompt ${paneId} "<text>"\` or use \`herdr agent send-keys ${paneId} <keys>\` for interactive controls.`;
}

function failedOperatorHint(paneId: string): string {
	return `Inspect with \`herdr agent read ${paneId} --source recent-unwrapped --lines 80\` and assess the failure. If this task has not already been retried and one simple corrective prompt could recover it, try once with \`herdr agent prompt ${paneId} "<text>"\`. If it fails again or the setup looks broken, stop retrying and tell the user.`;
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
			`<operator_hint>${xml(blockedOperatorHint(agent.pane_id))}</operator_hint>`,
		);
	}
	if (failed) {
		lines.push(
			`<operator_hint>${xml(failedOperatorHint(agent.pane_id))}</operator_hint>`,
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
