import { getCurrentPane, getSnapshot } from "../core/agents.js";
import type { CoreConnection } from "../core/backend.js";
import type { PaneInfo, PeerMessage } from "../types.js";

const DELEGATED_WORKER_GUIDANCE =
	"Your final assistant reply automatically reports the result or blocker to the parent. End the turn instead of sending a separate completion message. If blocked mid-run, use a question-asking tool, not peer messages. Without one, end with the blocker. Never watch your parent.";

export function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export interface AgentEventLabels {
	tab?: string;
	workspace?: string;
}

export function agentSource(
	agent: PaneInfo,
	labels: AgentEventLabels,
): Record<string, string | undefined> {
	const paneName = agent.label || agent.title;
	return {
		terminal: agent.terminal_id,
		...(agent.workspace_id ? { workspace: agent.workspace_id } : {}),
		...(agent.tab_id ? { tab: agent.tab_id } : {}),
		...(agent.name ? { name: agent.name } : {}),
		...(paneName ? { pane_name: paneName } : {}),
		...(labels.workspace ? { workspace_name: labels.workspace } : {}),
		...(labels.tab ? { tab_name: labels.tab } : {}),
	};
}

export function sourceAttributes(
	source: Record<string, string | undefined>,
): string {
	return Object.entries(source)
		.filter((entry): entry is [string, string] => entry[1] !== undefined)
		.map(
			([key, value]) =>
				`${key}="${xml(value).replaceAll("\n", "&#10;").replaceAll("\r", "&#13;")}"`,
		)
		.join(" ");
}

export async function attributeAgentPrompt(
	client: CoreConnection,
	sessionId: string,
	message: string,
	kind: "message" | "task",
	initialProfile?: string,
): Promise<PeerMessage> {
	const [pane, snapshot] = await Promise.all([
		getCurrentPane(client),
		getSnapshot(client),
	]);
	const workspace = snapshot.workspaces.find(
		(workspace) => workspace.workspace_id === pane.workspace_id,
	)?.label;
	const tab = snapshot.tabs.find((tab) => tab.tab_id === pane.tab_id)?.label;
	const identity = await client.machineIdentity();
	const source = {
		kind,
		host: identity.host,
		machine: identity.session,
		agent: `/${sessionId}`,
		...agentSource(pane, {
			...(workspace ? { workspace } : {}),
			...(tab ? { tab } : {}),
		}),
	};
	return {
		sender: `<herdr_sender ${sourceAttributes(source)} />`,
		text: message,
		context: [
			...(initialProfile
				? [
						`<initial_worker_profile>\n${initialProfile}\n</initial_worker_profile>`,
					]
				: []),
			...(kind === "task" ? [DELEGATED_WORKER_GUIDANCE] : []),
		].join("\n\n"),
	};
}
