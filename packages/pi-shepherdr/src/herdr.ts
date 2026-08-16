import type { HerdrConnection } from "./herdr-client.js";
import type {
	AgentStatus,
	PaneInfo,
	SessionSnapshot,
	WorkspaceInfo,
} from "./types.js";

const AGENT_STATUSES: ReadonlySet<string> = new Set([
	"idle",
	"working",
	"blocked",
	"done",
	"unknown",
]);

export async function getSnapshot(
	client: HerdrConnection,
): Promise<SessionSnapshot> {
	const result = record(
		await client.request<unknown>("session.snapshot", {}),
		"session.snapshot result",
	);
	return parseSessionSnapshot(result["snapshot"]);
}

export async function getAgent(
	client: HerdrConnection,
	target: string,
): Promise<PaneInfo> {
	const result = record(
		await client.request<unknown>("agent.get", { target }),
		"agent.get result",
	);
	return parsePaneInfo(result["agent"], "agent.get result.agent");
}

export async function resolvePiAgent(
	client: HerdrConnection,
	target: string,
	controllingPaneId = process.env["HERDR_PANE_ID"],
): Promise<PaneInfo> {
	const agent = await getAgent(client, target);
	if (agent.agent !== "pi") throw new Error(`${target} is not a Pi agent`);
	if (controllingPaneId && agent.pane_id === controllingPaneId) {
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

export function parsePaneInfo(value: unknown, path = "pane"): PaneInfo {
	const pane = record(value, path);
	return {
		pane_id: requiredString(pane, "pane_id", path),
		terminal_id: requiredString(pane, "terminal_id", path),
		workspace_id: requiredString(pane, "workspace_id", path),
		tab_id: requiredString(pane, "tab_id", path),
		agent_status: parseAgentStatus(
			pane["agent_status"],
			`${path}.agent_status`,
		),
		...optionalNullableString(pane, "agent", path),
		...optionalNullableString(pane, "cwd", path),
		...optionalNullableString(pane, "foreground_cwd", path),
		...optionalNullableString(pane, "name", path),
		...optionalBoolean(pane, "interactive_ready", path),
		...optionalBoolean(pane, "launch_pending", path),
		...parseAgentSession(pane["agent_session"], path),
	};
}

function parseSessionSnapshot(value: unknown): SessionSnapshot {
	const snapshot = record(value, "session.snapshot result.snapshot");
	return {
		agents: parseArray(snapshot, "agents", parsePaneInfo),
		panes: parseArray(snapshot, "panes", parsePaneInfo),
		tabs: parseArray(snapshot, "tabs", parseTabInfo),
		workspaces: parseArray(snapshot, "workspaces", parseWorkspaceInfo),
	};
}

function parseTabInfo(
	value: unknown,
	path: string,
): SessionSnapshot["tabs"][number] {
	const tab = record(value, path);
	return {
		tab_id: requiredString(tab, "tab_id", path),
		workspace_id: requiredString(tab, "workspace_id", path),
		label: requiredString(tab, "label", path),
	};
}

function parseWorkspaceInfo(value: unknown, path: string): WorkspaceInfo {
	const workspace = record(value, path);
	return {
		workspace_id: requiredString(workspace, "workspace_id", path),
		label: requiredString(workspace, "label", path),
	};
}

function parseArray<T>(
	parent: Record<string, unknown>,
	key: string,
	parse: (value: unknown, path: string) => T,
): T[] {
	const value = parent[key];
	if (!Array.isArray(value)) {
		throw new Error(
			`Herdr session.snapshot result.snapshot.${key} must be an array`,
		);
	}
	return value.map((item, index) =>
		parse(item, `session.snapshot result.snapshot.${key}[${index}]`),
	);
}

function parseAgentStatus(value: unknown, path: string): AgentStatus {
	if (typeof value === "string" && AGENT_STATUSES.has(value)) {
		return value as AgentStatus;
	}
	throw new Error(`Herdr ${path} has invalid status ${JSON.stringify(value)}`);
}

function parseAgentSession(
	value: unknown,
	path: string,
): Pick<PaneInfo, "agent_session"> | Record<never, never> {
	if (value === undefined) return {};
	if (value === null) return { agent_session: null };
	const session = record(value, `${path}.agent_session`);
	const kind = session["kind"];
	if (kind !== "id" && kind !== "path") {
		throw new Error(`Herdr ${path}.agent_session.kind must be id or path`);
	}
	return {
		agent_session: {
			agent: requiredString(session, "agent", `${path}.agent_session`),
			kind,
			source: requiredString(session, "source", `${path}.agent_session`),
			value: requiredString(session, "value", `${path}.agent_session`),
		},
	};
}

function optionalNullableString<
	K extends "agent" | "cwd" | "foreground_cwd" | "name",
>(
	value: Record<string, unknown>,
	key: K,
	path: string,
): Pick<PaneInfo, K> | Record<never, never> {
	const field = value[key];
	if (field === undefined) return {};
	if (field === null || typeof field === "string") {
		return { [key]: field } as Pick<PaneInfo, K>;
	}
	throw new Error(`Herdr ${path}.${key} must be string or null`);
}

function optionalBoolean<K extends "interactive_ready" | "launch_pending">(
	value: Record<string, unknown>,
	key: K,
	path: string,
): Pick<PaneInfo, K> | Record<never, never> {
	const field = value[key];
	if (field === undefined) return {};
	if (typeof field === "boolean") {
		return { [key]: field } as Pick<PaneInfo, K>;
	}
	throw new Error(`Herdr ${path}.${key} must be boolean`);
}

function requiredString(
	value: Record<string, unknown>,
	key: string,
	path: string,
): string {
	const field = value[key];
	if (typeof field === "string") return field;
	throw new Error(`Herdr ${path}.${key} must be string`);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	throw new Error(`Herdr ${path} must be an object`);
}
