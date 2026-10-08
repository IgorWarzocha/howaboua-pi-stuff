import { hostname } from "node:os";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { activityTask } from "./activity.js";
import type { BoardBinding } from "./board/identity.js";
import { sendPolicyMessage, startPreparedIdleTurn } from "./delivery.js";
import { getCurrentPane, getSnapshot } from "./herdr.js";
import type { HerdrConnection } from "./herdr-client.js";
import type {
	LatestAssistant,
	MachineStatus,
	MonitoredAgent,
	PaneInfo,
	PeerMessage,
	PendingAsk,
	ScopedMonitoredAgent,
	SettledAgentStatus,
} from "./types.js";

const AGENT_EVENT_MESSAGE_TYPE = "herdr-agent-event";
const BOARD_POST_MARKER = "shepherdr-board-post-marker";

export function recordBoardPostMarker(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	value: unknown,
): void {
	if (
		!value ||
		typeof value !== "object" ||
		!("message_id" in value) ||
		typeof value.message_id !== "string" ||
		!("channel_name" in value) ||
		typeof value.channel_name !== "string"
	)
		return;
	if (
		ctx.sessionManager
			.getBranch()
			.some(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === BOARD_POST_MARKER &&
					entry.data &&
					typeof entry.data === "object" &&
					"messageId" in entry.data &&
					entry.data.messageId === value.message_id,
			)
	)
		return;
	// Owner acknowledgements reach the sender here, never the subscription inbox.
	pi.appendEntry(BOARD_POST_MARKER, {
		messageId: value.message_id,
		channelName: value.channel_name,
	});
}
const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";
const MAX_REALTIME_VOICE_PROMPT_BYTES = 8 * 1_024;
const DELEGATED_WORKER_GUIDANCE =
	"If blocked mid-run, use a question-asking tool, not peer messages. Without one, end with the blocker. Finish with an assistant reply, not a separate send report; never watch your parent.";
export function orchestrationGuidance(enabled: boolean, general: boolean) {
	if (!enabled) return "Work normally. Delegate only when useful or requested.";
	return general
		? "Your main goal from now on is to orchestrate agents. Fan out suitable work to general agents, synthesize their results, and report the outcome. Work directly only when asked or for routine local tasks."
		: "Your main goal from now on is to orchestrate agents. Fan out suitable work, synthesize agent results, and report the outcome. Work directly only when asked or for routine local tasks.";
}
export function activeAgentsBriefing(
	agents: ScopedMonitoredAgent[],
	machines: MachineStatus[],
): string | undefined {
	const active = agents.filter((agent) => agent.activity.phase !== "settled");
	if (!active.length) return;
	return [
		"Existing agents after context rollover. Do not duplicate their work. Status is last observed; use these machine/target values for updates.",
		JSON.stringify(
			active.map((agent) => ({
				machine: agent.machine,
				target: agent.paneId,
				...(agent.name ? { name: agent.name } : {}),
				status: agent.activity.phase,
				connection:
					machines.find((machine) => machine.id === agent.machine)?.status ??
					"unavailable",
				...(agent.cwd ? { cwd: agent.cwd } : {}),
				...(activityTask(agent.activity)
					? { task: activityTask(agent.activity) }
					: {}),
			})),
		),
	].join("\n");
}
export function boardBriefing(
	member: boolean,
	population: "empty" | "populated" | "unavailable",
) {
	const state =
		population === "populated"
			? "Read relevant board threads."
			: population === "empty"
				? "Shared board available; no posts yet."
				: "Shared board status unavailable. Check board help and retry reading when available.";
	const setup = member
		? "The root agent owns setup; follow your assigned task."
		: "";
	return (
		[
			state,
			setup,
			"Post only new information that changes another agent's work: ownership, decisions, findings or blockers. Reply in existing threads; link rather than repeat. Keep personal checkpoints in notes. Skip acknowledgements, routine status and duplicated completion reports. Use agents for assignments and urgent messages.",
		]
			.filter(Boolean)
			.join(" ") +
		"\n\nChannels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result."
	);
}

export function attachmentMessage(
	controllerContextAgent?: string,
	boardAgent?: string,
) {
	return {
		customType: "herdr-agent-attachment",
		content: [
			...(controllerContextAgent
				? [
						`Controller notes/history: ${controllerContextAgent}; own context unchanged`,
					]
				: []),
			...(boardAgent ? [`Shared board: ${boardAgent}`] : []),
		].join("\n"),
		display: true,
	};
}

export function detachmentMessage(
	controllerContextAgent?: string,
	board?: BoardBinding,
) {
	return {
		customType: "herdr-agent-detachment",
		content: [
			...(controllerContextAgent
				? [
						`Detached controller: ${controllerContextAgent}; checkpoints read-only, history unavailable; own context unchanged`,
					]
				: []),
			...(board
				? [`Board restored: ${board.boardId} as ${board.agentName}`]
				: []),
		].join("\n"),
		display: true,
	};
}

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

export function agentSource(agent: PaneInfo, labels: AgentEventLabels) {
	const paneName = agent.label || agent.title;
	return {
		pane: agent.pane_id,
		workspace: agent.workspace_id,
		tab: agent.tab_id,
		...(agent.name ? { name: agent.name } : {}),
		...(paneName ? { pane_name: paneName } : {}),
		...(labels.workspace ? { workspace_name: labels.workspace } : {}),
		...(labels.tab ? { tab_name: labels.tab } : {}),
	};
}

function sourceAttributes(source: Record<string, string | undefined>): string {
	return Object.entries(source)
		.filter((entry): entry is [string, string] => entry[1] !== undefined)
		.map(
			([key, value]) =>
				`${key}="${xml(value).replaceAll("\n", "&#10;").replaceAll("\r", "&#13;")}"`,
		)
		.join(" ");
}

export async function attributeAgentPrompt(
	client: HerdrConnection,
	message: string,
	kind: "message" | "task",
): Promise<PeerMessage> {
	const [pane, snapshot] = await Promise.all([
		getCurrentPane(client),
		getSnapshot(client),
	]);
	const workspace = snapshot.workspaces.find(
		(workspace) => workspace.workspace_id === pane.workspace_id,
	)?.label;
	const tab = snapshot.tabs.find((tab) => tab.tab_id === pane.tab_id)?.label;
	const source = {
		kind,
		host: hostname(),
		session: process.env["HERDR_SESSION"] || "default",
		...agentSource(pane, {
			...(workspace ? { workspace } : {}),
			...(tab ? { tab } : {}),
		}),
	};
	return {
		sender: `<herdr_sender ${sourceAttributes(source)} />`,
		text: message,
		...(kind === "task" ? { context: DELEGATED_WORKER_GUIDANCE } : {}),
	};
}

interface AgentEventOptions {
	agent: PaneInfo;
	agentToolName: string;
	ask?: PendingAsk;
	blockedMessage?: string;
	labels: AgentEventLabels;
	machine: string;
	machineLabel: string;
	operatorPrefix: string;
	record: MonitoredAgent;
	reply?: LatestAssistant;
	status: SettledAgentStatus | "question";
}

export function modelAsk(ask: PendingAsk) {
	return {
		ask_id: ask.toolCallId,
		...(ask.delivery ? { delivery: ask.delivery } : {}),
		handoff: ask.handoff,
		prompts: ask.prompts,
	};
}

interface AgentEventDetails {
	ask?: PendingAsk;
	blockedOn?: string;
	cwd?: string;
	machine: string;
	machineLabel?: string;
	name?: string;
	paneId: string;
	response?: string;
	state: "blocked" | "failed" | "finished" | "question";
	tab?: string;
	task?: string;
	workspace?: string;
}

function eventAsk(value: unknown): PendingAsk | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (
		typeof record["toolCallId"] !== "string" ||
		typeof record["handoff"] !== "boolean" ||
		!Array.isArray(record["prompts"])
	) {
		return undefined;
	}
	const prompts: PendingAsk["prompts"] = [];
	for (const value of record["prompts"]) {
		if (typeof value !== "object" || value === null) return undefined;
		const prompt = value as Record<string, unknown>;
		if (
			typeof prompt["title"] !== "string" ||
			typeof prompt["multiple"] !== "boolean" ||
			!Array.isArray(prompt["choices"])
		) {
			return undefined;
		}
		const choices: PendingAsk["prompts"][number]["choices"] = [];
		for (const value of prompt["choices"]) {
			if (typeof value !== "object" || value === null) return undefined;
			const choice = value as Record<string, unknown>;
			if (typeof choice["label"] !== "string") return undefined;
			choices.push({
				label: choice["label"],
				...(typeof choice["description"] === "string"
					? { description: choice["description"] }
					: {}),
			});
		}
		prompts.push({
			title: prompt["title"],
			multiple: prompt["multiple"],
			choices,
			...(typeof prompt["body"] === "string" ? { body: prompt["body"] } : {}),
		});
	}
	if (prompts.length === 0) return undefined;
	return {
		toolCallId: record["toolCallId"],
		...(record["delivery"] === "steer" ? { delivery: "steer" as const } : {}),
		handoff: record["handoff"],
		prompts,
	};
}

function boundedVoicePrompt(prompt: string): string {
	const bytes = new TextEncoder().encode(prompt);
	if (bytes.byteLength <= MAX_REALTIME_VOICE_PROMPT_BYTES) return prompt;
	return new TextDecoder()
		.decode(bytes.subarray(0, MAX_REALTIME_VOICE_PROMPT_BYTES), {
			stream: true,
		})
		.trimEnd();
}

function agentVoicePrompt(details: AgentEventDetails): string {
	const lines = [
		`Worker: ${details.machineLabel ?? details.machine} / ${details.name?.trim() || "unnamed"}`,
		`State: ${details.state}`,
	];
	if (details.task?.trim()) lines.push(`Task:\n${details.task.trim()}`);
	let instruction: string;
	if (details.state === "blocked" || details.state === "question") {
		instruction =
			details.state === "question"
				? "Briefly tell the user what this worker asks while it continues working."
				: "Briefly tell the user why this monitored worker is blocked and what attention may be required.";
		if (details.blockedOn?.trim())
			lines.push(`Reason:\n${details.blockedOn.trim()}`);
		if (details.ask) {
			lines.push(
				`Questions:\n${details.ask.prompts.map((prompt) => prompt.title).join(", ")}`,
			);
		}
	} else {
		instruction =
			details.state === "failed"
				? "Briefly tell the user that this monitored worker failed and include useful detail from its report."
				: "Briefly tell the user what this monitored worker found or completed; do not merely announce that it finished.";
		if (details.response?.trim())
			lines.push(`Report:\n${details.response.trim()}`);
	}
	return boundedVoicePrompt(`${instruction}\n\n${lines.join("\n\n")}`);
}

function announceAgentEvent(
	pi: ExtensionAPI,
	candidateId: string,
	prompt: string,
): void {
	const id =
		new TextEncoder().encode(candidateId).byteLength <= 160
			? candidateId
			: "pi-shepherdr:worker";
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: true, prompt });
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: false, prompt });
}

export function announcePeerMessage(
	pi: ExtensionAPI,
	message: PeerMessage,
): void {
	const source = Object.fromEntries(
		Array.from(
			message.sender.matchAll(/ ([a-z_]+)="([^"]*)"/g),
			([, key, value]) => [key, value],
		),
	);
	if (source["kind"] !== "message" || message.text.startsWith("/")) return;
	announceAgentEvent(
		pi,
		`pi-shepherdr:${source["host"] ?? "local"}:${source["pane"] ?? "peer"}`,
		boundedVoicePrompt(
			`Briefly tell the user the useful update from this peer.\n\nPeer: ${source["host"] ?? "local"} / ${source["name"] || source["pane"] || "unnamed"}\n\nUpdate:\n${message.text.trim()}`,
		),
	);
}

function operatorCommand(operatorPrefix: string, command: string): string {
	return `\`${operatorPrefix} ${command}\``;
}

function blockedOperatorHint(
	agentToolName: string,
	machine: string,
	operatorPrefix: string,
	paneId: string,
): string {
	return `Inspect first with ${operatorCommand(operatorPrefix, `agent read ${paneId} --source visible`)}; respond through ${agentToolName} with machine=${JSON.stringify(machine)}, or use ${operatorCommand(operatorPrefix, `agent send-keys ${paneId} <keys>`)} for interactive controls.`;
}

function failedOperatorHint(
	agentToolName: string,
	machine: string,
	operatorPrefix: string,
	paneId: string,
): string {
	return `Inspect with ${operatorCommand(operatorPrefix, `agent read ${paneId} --source recent-unwrapped --lines 80`)} and assess the failure. If this task has not already been retried and one simple corrective prompt could recover it, try once through ${agentToolName} with machine=${JSON.stringify(machine)}. If it fails again or the setup looks broken, stop retrying and tell the user.`;
}

function eventDetails(value: unknown): AgentEventDetails | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const details = value as Record<string, unknown>;
	if (
		typeof details["paneId"] !== "string" ||
		(details["machine"] !== undefined &&
			typeof details["machine"] !== "string") ||
		(details["state"] !== "blocked" &&
			details["state"] !== "question" &&
			details["state"] !== "failed" &&
			details["state"] !== "finished")
	) {
		return undefined;
	}
	const optional = (field: keyof AgentEventDetails) =>
		typeof details[field] === "string"
			? { [field]: details[field] as string }
			: {};
	const ask = eventAsk(details["ask"]);
	return {
		machine:
			typeof details["machine"] === "string" ? details["machine"] : "local",
		paneId: details["paneId"],
		state: details["state"],
		...(ask ? { ask } : {}),
		...optional("blockedOn"),
		...optional("cwd"),
		...optional("machineLabel"),
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
	const {
		agent,
		agentToolName,
		ask,
		blockedMessage,
		labels,
		machine,
		machineLabel,
		operatorPrefix,
		record,
		reply,
		status,
	} = options;
	const task = activityTask(record.activity);
	const blocked = status === "blocked";
	const question = status === "question";
	const failed = !blocked && reply?.stopReason === "error";
	const cwd = agent.foreground_cwd ?? agent.cwd ?? record.cwd;
	const tag = question
		? "herdr_agent_question"
		: blocked
			? "herdr_agent_blocked"
			: failed
				? "herdr_agent_failed"
				: "herdr_agent_result";
	const attributes = sourceAttributes({
		machine,
		machine_name: machineLabel !== machine ? machineLabel : undefined,
		...agentSource(agent, labels),
		name: agent.name ?? record.name,
		directory: cwd,
	});
	const lines = [`<${tag} ${attributes}>`];
	if (task) lines.push(`<task>${xml(task)}</task>`);
	if (blockedMessage) {
		lines.push(`<blocked_on>${xml(blockedMessage)}</blocked_on>`);
	}
	if ((blocked || question) && ask) {
		lines.push(`<ask>${xml(JSON.stringify(modelAsk(ask)))}</ask>`);
	}
	if (blocked) {
		lines.push(
			`<operator_hint>${xml(blockedOperatorHint(agentToolName, machine, operatorPrefix, agent.pane_id))}</operator_hint>`,
		);
	}
	if (question && ask) {
		lines.push(
			`<operator_hint>${xml(`Worker continues. Answer via ${agentToolName} action=answer machine=${JSON.stringify(machine)} target=${JSON.stringify(agent.pane_id)} ask_id=${JSON.stringify(ask.toolCallId)} answers=[...]`)}</operator_hint>`,
		);
	}
	if (failed) {
		lines.push(
			`<operator_hint>${xml(failedOperatorHint(agentToolName, machine, operatorPrefix, agent.pane_id))}</operator_hint>`,
		);
	}
	if (reply) lines.push(`<response>${xml(reply.text)}</response>`);
	lines.push(`</${tag}>`);

	return {
		content: lines.join("\n"),
		details: {
			machine,
			machineLabel,
			paneId: agent.pane_id,
			state: question
				? "question"
				: blocked
					? "blocked"
					: failed
						? "failed"
						: "finished",
			...((blocked || question) && ask ? { ask } : {}),
			...(agent.name || record.name ? { name: agent.name || record.name } : {}),
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
	const idle = ctx.isIdle();
	const delivery = idle
		? { triggerTurn: false, deliverAs: "nextTurn" as const }
		: { deliverAs: "steer" as const };
	sendPolicyMessage(
		pi,
		{
			customType: AGENT_EVENT_MESSAGE_TYPE,
			content: message.content,
			details: message.details,
			display: true,
		},
		delivery,
	);
	if (idle) startPreparedIdleTurn(pi, ctx);
	announceAgentEvent(
		pi,
		`pi-shepherdr:${message.details.machine}:${message.details.paneId}`,
		agentVoicePrompt(message.details),
	);
}

export function registerAgentEventRenderer(pi: ExtensionAPI): void {
	pi.registerEntryRenderer(BOARD_POST_MARKER, (entry, { expanded }, theme) => {
		const data = entry.data;
		const name =
			data &&
			typeof data === "object" &&
			"channelName" in data &&
			typeof data.channelName === "string" &&
			data.channelName.trim()
				? data.channelName.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
				: "Board";
		const summary = new Text(
			theme.style(`Posted to board · ${name}`, {
				fg: "syntaxString",
				dim: true,
			}),
			0,
			0,
		);
		if (!expanded) return summary;
		const details = new Box(0, 0);
		details.addChild(summary);
		details.addChild(new Text(JSON.stringify(data, null, 2) ?? "", 0, 0));
		return details;
	});
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
			const question = details.state === "question";
			const agentIdentity = details?.name
				? `${details.name} (${details.paneId})`
				: (details?.paneId ?? "unknown");
			const identity = `${details.machineLabel ?? details.machine} / ${agentIdentity}`;
			const title = theme.fg(
				blocked || failed ? "error" : "success",
				`Herdr agent ${identity} · ${question ? "question pending, worker continues" : blocked ? "blocked" : failed ? "failed" : "finished"}`,
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
			if (blocked || question) {
				box.addChild(new Spacer(1));
				box.addChild(
					new Text(
						theme.fg(
							"warning",
							details?.blockedOn ??
								(question
									? "Question pending"
									: "Agent needs input or approval"),
						),
						0,
						0,
					),
				);
				if (details.ask) {
					box.addChild(
						new Text(
							theme.fg(
								"muted",
								`Questions: ${details.ask.prompts.map((prompt) => prompt.title).join(", ")}`,
							),
							0,
							0,
						),
					);
					if (expanded) {
						for (const prompt of details.ask.prompts) {
							box.addChild(new Spacer(1));
							box.addChild(new Text(theme.fg("muted", prompt.title), 0, 0));
							if (prompt.body) {
								box.addChild(
									new Markdown(prompt.body, 0, 0, getMarkdownTheme()),
								);
							}
							if (prompt.choices.length > 0) {
								box.addChild(
									new Text(
										`Choices: ${prompt.choices.map((choice) => choice.label).join(", ")}`,
										0,
										0,
									),
								);
							}
						}
					}
				}
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
