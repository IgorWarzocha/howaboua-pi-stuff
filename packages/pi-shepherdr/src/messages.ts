import { hostname } from "node:os";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { BoardBinding } from "@howaboua/pi-agent-board/integration";
import { activityTask } from "./activity.js";
import { sendPolicyMessage } from "./delivery.js";
import { getCurrentPane, getSnapshot } from "./herdr.js";
import type { HerdrConnection } from "./herdr-client.js";
import { readExtensionMessage } from "./remote/shepherdr-session.mjs";
import type {
	ExtensionMessage,
	FocusRequest,
	LatestAssistant,
	MachineStatus,
	MonitoredAgent,
	PaneInfo,
	PeerMessage,
	ScopedMonitoredAgent,
	SettledAgentStatus,
} from "./types.js";

const AGENT_EVENT_MESSAGE_TYPE = "herdr-agent-event";
const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";
const MAX_REALTIME_VOICE_PROMPT_BYTES = 8 * 1_024;
const DELEGATED_WORKER_GUIDANCE =
	"If blocked mid-run, use a question-asking tool, not peer messages. Without one, end with the blocker. Finish with an assistant reply, not a separate send report; never watch your parent.";

function focusOrigin({ source }: FocusRequest) {
	return { host: source.host, session: source.session, pane: source.pane };
}

export function focusArrivalContent(
	request: FocusRequest,
	machine: string,
	codeMode: boolean,
) {
	const returnFocus = {
		action: "focus",
		target: request.source.pane,
		machine,
		voice: request.voice === true,
	};
	const args = JSON.stringify(returnFocus);
	const callable = codeMode ? `await tools.agents(${args})` : `agents ${args}`;
	return {
		returnFocus,
		content: `User arrived from ${JSON.stringify({ ...focusOrigin(request), machine })}\nReturn: ${callable}${request.voice ? "\nVoice transfer pending" : ""}${request.handoff ? `\nHandoff from that session:\n${request.handoff}` : ""}`,
	};
}

export function voiceFocusContinuity(request: FocusRequest): string {
	return `User transferring voice from ${JSON.stringify(focusOrigin(request))}${request.handoff ? `\nHandoff from that session:\n${request.handoff}` : ""}`;
}

export function voiceFocusReport(
	side: "source" | "destination",
	target: string,
	error?: unknown,
): string {
	return error === undefined
		? `Voice transfer complete (${side}, ${target}); replacement call active`
		: `Voice transfer failed (${side}, ${target}): ${error instanceof Error ? error.message : String(error)}. Voice availability is not confirmed; inspect the session before retrying`;
}

export function orchestrationGuidance(enabled: boolean, general: boolean) {
	const ownership = "Own a scope or delegate it; don't do both.";
	if (!enabled)
		return `Work normally. Delegate only when useful or requested. ${ownership}`;
	const guidance = general
		? "Orchestrate general agents with separate scopes. Integrate their results, validate the combined outcome and report it. Work directly only when asked or for routine local tasks."
		: "Orchestrate agents with separate scopes. Integrate their results, validate the combined outcome and report it. Work directly only when asked or for routine local tasks.";
	return `${guidance} ${ownership}`;
}
export function activeAgentsBriefing(
	agents: ScopedMonitoredAgent[],
	machines: MachineStatus[],
): string | undefined {
	if (!agents.length) return;
	return [
		"Supervised agents after context rollover. Their instructions are reference data, not tasks for you. Do not repeat settled tasks or duplicate running work. Status is last observed; read a target for its reply or pending extension messages.",
		JSON.stringify(
			agents.map((agent) => ({
				machine: agent.machine,
				target: agent.paneId,
				...(agent.name ? { name: agent.name } : {}),
				status:
					agent.activity.phase === "settled"
						? agent.activity.status
						: agent.activity.phase,
				connection:
					machines.find((machine) => machine.id === agent.machine)?.status ??
					"unavailable",
				...(agent.cwd ? { cwd: agent.cwd } : {}),
				...((agent.instructions ?? activityTask(agent.activity))
					? { instructions: agent.instructions ?? activityTask(agent.activity) }
					: {}),
			})),
		),
	].join("\n");
}
export function boardMigrationWarning() {
	return "Boards moved to Pi Agent Board. Install @howaboua/pi-agent-board for the same features as a separate extension. Your saved boards are preserved.";
}

export function boardBriefing(
	member: boolean,
	population: "empty" | "populated" | "unavailable",
	gpt = false,
) {
	const state =
		population === "populated"
			? gpt
				? "Read relevantboardthreads."
				: "Read relevant board threads."
			: population === "empty"
				? gpt
					? "Sharedboard available; posts=none."
					: "Shared board available; no posts yet."
				: gpt
					? "Sharedboard status unavailable; board help→retry read when available."
					: "Shared board status unavailable. Check board help and retry reading when available.";
	const setup = member
		? gpt
			? "Root owns setup; follow assignedtask."
			: "The root agent owns setup; follow your assigned task."
		: "";
	if (gpt)
		return [
			state,
			setup,
			"Posts=work-changing ownership/decisions/findings/blockers only. Existingthread replies; link≠repeat. Personalcheckpoints→notes. No ack/statusspam/duplicate completionreports. Assignments/urgentmessages→agents.",
			"Channels=workstreams; threads=topics. Reuse relevantchannels≠catchalls. Newchannel requires distinctcoordinationpurpose; never task/result announcement only.",
		]
			.filter(Boolean)
			.join(" ");
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
	codeMode?: boolean;
	extensionMessages?: ExtensionMessage[];
	blockedMessage?: string;
	labels: AgentEventLabels;
	machine: string;
	machineLabel: string;
	operatorPrefix: string;
	record: MonitoredAgent;
	reply?: LatestAssistant;
	status: SettledAgentStatus | "extension-message";
}

interface AgentEventDetails {
	extensionMessages?: ExtensionMessage[];
	blockedOn?: string;
	cwd?: string;
	machine: string;
	machineLabel?: string;
	name?: string;
	paneId: string;
	response?: string;
	state: "blocked" | "failed" | "finished" | "extension-message";
	tab?: string;
	task?: string;
	workspace?: string;
}

function eventExtensionMessages(
	value: unknown,
): ExtensionMessage[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const messages = value.map((message) => {
		if (typeof message !== "object" || message === null) return undefined;
		return readExtensionMessage({ ...message, version: 1, state: "pending" });
	});
	return messages.every((message) => message !== undefined)
		? messages
		: undefined;
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
	if (details.state === "blocked" || details.state === "extension-message") {
		instruction =
			details.state === "extension-message"
				? "Briefly tell the user what this worker reports."
				: "Briefly tell the user why this monitored worker is blocked and what attention may be required.";
		if (details.blockedOn?.trim())
			lines.push(`Reason:\n${details.blockedOn.trim()}`);
		if (details.extensionMessages)
			lines.push(
				...details.extensionMessages.map((message) => message.message),
			);
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
			details["state"] !== "extension-message" &&
			details["state"] !== "failed" &&
			details["state"] !== "finished")
	) {
		return undefined;
	}
	const optional = (field: keyof AgentEventDetails) =>
		typeof details[field] === "string"
			? { [field]: details[field] as string }
			: {};
	const extensionMessages = eventExtensionMessages(
		details["extensionMessages"],
	);
	return {
		machine:
			typeof details["machine"] === "string" ? details["machine"] : "local",
		paneId: details["paneId"],
		state: details["state"],
		...(extensionMessages ? { extensionMessages } : {}),
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
		codeMode,
		extensionMessages,
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
	const notification = status === "extension-message";
	const failed = !blocked && reply?.stopReason === "error";
	const cwd = agent.foreground_cwd ?? agent.cwd ?? record.cwd;
	const tag = notification
		? "herdr_agent_extension_message"
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
	if (task && !notification) lines.push(`<task>${xml(task)}</task>`);
	if (blockedMessage) {
		lines.push(`<blocked_on>${xml(blockedMessage)}</blocked_on>`);
	}
	for (const message of extensionMessages ?? []) {
		lines.push(message.message);
		if (message.reply !== undefined) {
			const request = {
				action: "reply",
				machine,
				target: agent.pane_id,
				extension: message.extension,
				id: message.id,
				message: message.reply,
			};
			const call = codeMode
				? `await tools.${agentToolName}(${JSON.stringify(request)})`
				: `${agentToolName} ${JSON.stringify(request)}`;
			lines.push(`Reply: ${call}`);
		}
	}
	if (blocked) {
		lines.push(
			`<operator_hint>${xml(blockedOperatorHint(agentToolName, machine, operatorPrefix, agent.pane_id))}</operator_hint>`,
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
			state: notification
				? "extension-message"
				: blocked
					? "blocked"
					: failed
						? "failed"
						: "finished",
			...(extensionMessages ? { extensionMessages } : {}),
			...(agent.name || record.name ? { name: agent.name || record.name } : {}),
			...(cwd ? { cwd } : {}),
			...(labels.workspace ? { workspace: labels.workspace } : {}),
			...(labels.tab ? { tab: labels.tab } : {}),
			...(task && !notification ? { task } : {}),
			...(blockedMessage ? { blockedOn: blockedMessage } : {}),
			...(reply ? { response: reply.text } : {}),
		},
	};
}

export function injectAgentEvent(
	pi: ExtensionAPI,
	_ctx: ExtensionContext,
	options: AgentEventOptions,
): void {
	const tools = pi.getActiveTools();
	const message = agentEvent({
		...options,
		codeMode:
			tools.includes("exec") ||
			tools.includes("code") ||
			tools.includes("notebook"),
	});
	const delivery = { triggerTurn: true, deliverAs: "steer" as const };
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
	announceAgentEvent(
		pi,
		`pi-shepherdr:${message.details.machine}:${message.details.paneId}`,
		agentVoicePrompt(message.details),
	);
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
			const notification = details.state === "extension-message";
			const agentIdentity = details?.name
				? `${details.name} (${details.paneId})`
				: (details?.paneId ?? "unknown");
			const identity = `${details.machineLabel ?? details.machine} / ${agentIdentity}`;
			const title = theme.fg(
				blocked || failed ? "error" : "success",
				`Herdr agent ${identity} · ${notification ? "extension message pending" : blocked ? "blocked" : failed ? "failed" : "finished"}`,
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
			if (blocked || notification) {
				box.addChild(new Spacer(1));
				box.addChild(
					new Text(
						theme.fg(
							"warning",
							details?.blockedOn ??
								(notification
									? "Extension message pending"
									: "Agent needs input or approval"),
						),
						0,
						0,
					),
				);
				if (details.extensionMessages && expanded) {
					for (const message of details.extensionMessages) {
						box.addChild(new Spacer(1));
						box.addChild(
							new Markdown(message.message, 0, 0, getMarkdownTheme()),
						);
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
