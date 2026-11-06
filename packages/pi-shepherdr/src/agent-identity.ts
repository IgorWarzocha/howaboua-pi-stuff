import { sessionPath } from "./core/agents.js";
import type { CoreConnection } from "./core/backend.js";
import type { AgentFleet } from "./fleet/index.js";
import { sessionContextPath } from "./remote/shepherdr-context.mjs";
import type { PaneInfo } from "./types.js";

/** Read the live Pi owner, never infer identity from a filename or terminal ID. */
export async function nativeAgentName(
	client: CoreConnection,
	panel: PaneInfo,
	signal?: AbortSignal,
): Promise<string> {
	const file = sessionPath(panel);
	if (!file) throw new Error("Agent has no saved Pi session");
	const value = await client.requestContext(
		sessionContextPath(file),
		{ operation: "agent-identity" },
		signal,
	);
	if (
		!value ||
		typeof value !== "object" ||
		!("sessionId" in value) ||
		typeof value.sessionId !== "string" ||
		!value.sessionId ||
		/[/\\\u0000]/.test(value.sessionId)
	)
		throw new Error(
			"Agent identity unavailable; update and reload Shepherdr on the target",
		);
	if (value.sessionId === "root")
		throw new Error(
			"Pi session ID root conflicts with the legacy /root reference; start a session with another ID",
		);
	return `/${value.sessionId}`;
}

export async function resolveNativeAgent(
	fleet: AgentFleet,
	name: string,
	machine?: string,
	signal?: AbortSignal,
) {
	const snapshots = await fleet.snapshots(machine);
	const candidates = snapshots.flatMap((entry) => {
		if (!entry.snapshot) return [];
		const runtime = fleet.connected(entry.id);
		return entry.snapshot.agents
			.filter((panel) => panel.agent === "pi" && sessionPath(panel))
			.map((panel) => ({ runtime, panel }));
	});
	const found = await Promise.all(
		candidates.map(async (candidate) => {
			try {
				return (await nativeAgentName(
					candidate.runtime.client,
					candidate.panel,
					signal,
				)) === name
					? candidate
					: undefined;
			} catch {
				signal?.throwIfAborted();
				return undefined;
			}
		}),
	);
	const matches = found.filter((candidate) => candidate !== undefined);
	if (matches.length !== 1)
		throw new Error(
			matches.length
				? `Multiple live agents use ${name}; select an exact terminal target and machine`
				: `No reachable live agent ${name}; use find for an exact target or reconnect its machine`,
		);
	return matches[0]!;
}

export function sameAgentIdentity(
	expected: PaneInfo,
	current: PaneInfo,
): boolean {
	return (
		current.pane_id === expected.pane_id &&
		current.workspace_id === expected.workspace_id &&
		current.tab_id === expected.tab_id &&
		current.terminal_id === expected.terminal_id &&
		current.agent_session?.agent === expected.agent_session?.agent &&
		current.agent_session?.kind === expected.agent_session?.kind &&
		current.agent_session?.source === expected.agent_session?.source &&
		current.agent_session?.value === expected.agent_session?.value
	);
}
