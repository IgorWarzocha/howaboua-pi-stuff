import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { activityTask } from "../activity.js";
import { sendPolicyMessage } from "../delivery.js";
import type {
	ExtensionMessage,
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
	SettledAgentStatus,
} from "../types.js";
import {
	type AgentEventLabels,
	agentSource,
	sourceAttributes,
	xml,
} from "./attribution.js";
import {
	AGENT_EVENT_MESSAGE_TYPE,
	type AgentEventDetails,
} from "./event-details.js";
import { agentVoicePrompt, announceAgentEvent } from "./voice-announcements.js";

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
