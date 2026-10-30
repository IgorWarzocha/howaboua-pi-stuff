import { hostname } from "node:os";
import { getCurrentPane, getSnapshot } from "../herdr.js";
import type { HerdrConnection } from "../herdr-client.js";
import type { PaneInfo, PeerMessage } from "../types.js";

const DELEGATED_WORKER_GUIDANCE =
	"If blocked mid-run, use a question-asking tool, not peer messages. Without one, end with the blocker. Finish with an assistant reply, not a separate send report; never watch your parent.";

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
		...(agent.backend === "core"
			? { terminal: agent.terminal_id }
			: { pane: agent.pane_id }),
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
		...(pane.backend === "core"
			? await client.machineIdentity()
			: {
					host: hostname(),
					session: process.env["HERDR_SESSION"] || "default",
				}),
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
