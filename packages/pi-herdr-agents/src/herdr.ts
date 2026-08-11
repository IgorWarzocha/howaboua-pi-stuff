import type { HerdrClient } from "./herdr-client.js";
import type { PaneInfo, SessionSnapshot, WorkspaceInfo } from "./types.js";

export async function getSnapshot(
	client: HerdrClient,
): Promise<SessionSnapshot> {
	const result = await client.request<{ snapshot: SessionSnapshot }>(
		"session.snapshot",
		{},
	);
	return result.snapshot;
}

export async function getAgent(
	client: HerdrClient,
	target: string,
): Promise<PaneInfo> {
	const result = await client.request<{ agent: PaneInfo }>("agent.get", {
		target,
	});
	return result.agent;
}

export async function resolvePiAgent(
	client: HerdrClient,
	target: string,
): Promise<PaneInfo> {
	const agent = await getAgent(client, target);
	if (agent.agent !== "pi") throw new Error(`${target} is not a Pi agent`);
	if (agent.pane_id === process.env["HERDR_PANE_ID"]) {
		throw new Error("refusing to target the controlling Pi session");
	}
	return agent;
}

export function resolveWorkspace(
	snapshot: SessionSnapshot,
	target: string,
): WorkspaceInfo {
	const direct = snapshot.workspaces.find(
		(workspace) => workspace.workspace_id === target,
	);
	if (direct) return direct;
	const matches = snapshot.workspaces.filter(
		(workspace) => workspace.label === target,
	);
	if (matches.length === 1) return matches[0]!;
	if (matches.length > 1) {
		throw new Error(
			`workspace label ${JSON.stringify(target)} is ambiguous; use its Herdr ID`,
		);
	}
	throw new Error(`no Herdr workspace matches ${JSON.stringify(target)}`);
}

export function sessionPath(agent: PaneInfo): string | undefined {
	return agent.agent_session?.kind === "path"
		? agent.agent_session.value
		: undefined;
}
