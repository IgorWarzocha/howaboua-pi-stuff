import type { PaneInfo, SessionSnapshot } from "../types.js";
import type { CoreConnection } from "./backend.js";
import { object } from "./protocol.js";
import { terminalPane, terminalSnapshot } from "./terminal.js";
import { terminalPeer } from "./terminal-peer.mjs";

export async function getSnapshot(
	client: CoreConnection,
): Promise<SessionSnapshot> {
	return terminalSnapshot(await client.core.localSnapshot());
}

export async function getAgent(
	client: CoreConnection,
	target: string,
): Promise<PaneInfo> {
	if (/^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/.test(target)) {
		try {
			return terminalPane(
				await client.core.request("terminal.get", { terminal: target }),
			);
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"kind" in error &&
					error.kind === "not_found"
				)
			)
				throw error;
		}
	}
	const snapshot = await getSnapshot(client);
	const matches = snapshot.agents.filter((agent) => agent.name === target);
	if (matches.length > 1)
		throw new Error("Agent name is ambiguous; use its terminal address");
	const agent = matches[0];
	if (!agent)
		throw Object.assign(
			new Error(
				`No Pi agent matches ${JSON.stringify(target)}; use the exact target returned by spawn/find`,
			),
			{ kind: "not_found" },
		);
	return terminalPane(
		await client.core.request("terminal.get", { terminal: agent.terminal_id }),
	);
}

export async function getCurrentPane(
	client: CoreConnection,
): Promise<PaneInfo> {
	const terminal = process.env["HC_TERMINAL_ID"];
	if (!terminal || client.remote)
		throw new Error(
			"Cannot identify this terminal; run Pi inside a local Core terminal",
		);
	return terminalPane(await client.core.request("terminal.get", { terminal }));
}

export async function resolvePiAgent(
	client: CoreConnection,
	target: string,
	controllingPaneId = process.env["HC_TERMINAL_ID"],
): Promise<PaneInfo> {
	const agent = await getAgent(client, target);
	if (agent.agent !== "pi") throw new Error(`${target} is not a Pi agent`);
	if (controllingPaneId && agent.terminal_id === controllingPaneId)
		throw new Error("refusing to target the controlling Pi session");
	return agent;
}

export function sessionPath(agent: PaneInfo): string | undefined {
	return agent.agent_session?.kind === "path"
		? agent.agent_session.value
		: undefined;
}

export async function closeTerminal(
	client: CoreConnection,
	terminal: string,
): Promise<void> {
	await terminalPeer((method, params) =>
		client.core.request(method, params),
	).closeTerminal(terminal);
}

export async function readTerminal(
	client: CoreConnection,
	terminal: string,
	lines: number,
): Promise<{ text: string; truncated: boolean }> {
	const result = object(
		await client.core.request("terminal.read", { terminal, lines }),
	);
	if (
		typeof result["text"] !== "string" ||
		typeof result["complete"] !== "boolean"
	)
		throw new Error("Core returned no terminal text");
	return { text: result["text"], truncated: !result["complete"] };
}
