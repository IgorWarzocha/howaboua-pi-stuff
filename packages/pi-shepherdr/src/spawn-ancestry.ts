import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { nativeAgentName } from "./agent-identity.js";
import {
	type NativeSessionIdentity,
	type SpawnAncestry,
	savedSpawnAncestry,
} from "./ancestry-record.js";
import { sessionPath } from "./core/agents.js";
import type { AgentFleet } from "./fleet/index.js";
import { markedWorker } from "./worker-role.js";

export type { SpawnAncestry } from "./ancestry-record.js";

function rootIdentity(
	ctx: ExtensionContext,
	fleet: AgentFleet,
): NativeSessionIdentity {
	const ancestry = savedSpawnAncestry(ctx);
	if (ancestry) return ancestry.root;
	// Older workers have no machine-qualified root. Optional sharing is not proof.
	const legacyParent = ctx.sessionManager.getEntries().some((entry) => {
		if (
			entry.type !== "custom" ||
			entry.customType !== "codex-agent-relationship"
		)
			return false;
		const value = entry.data;
		return (
			!!value &&
			typeof value === "object" &&
			"threadId" in value &&
			value.threadId === ctx.sessionManager.getSessionId() &&
			"parentThreadId" in value &&
			typeof value.parentThreadId === "string" &&
			!!value.parentThreadId
		);
	});
	if (markedWorker(ctx.sessionManager) || legacyParent)
		throw new Error(
			"This worker has no saved ancestry; use an exact agent target or resume it from its parent",
		);
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("Ancestry requires a saved Pi session");
	return {
		machine: fleet.localMachine(),
		sessionId: ctx.sessionManager.getSessionId(),
		sessionFile,
	};
}

/** Prepare before launch; the child persists this only after optional bindings. */
export async function prepareLaunchAncestry(
	ctx: ExtensionContext,
	fleet: AgentFleet,
	signal?: AbortSignal,
): Promise<SpawnAncestry> {
	signal?.throwIfAborted();
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile)
		throw new Error("Spawning requires a saved parent Pi session");
	return {
		parent: {
			machine: fleet.localMachine(),
			sessionId: ctx.sessionManager.getSessionId(),
			sessionFile,
		},
		root: rootIdentity(ctx, fleet),
	};
}

export async function resolveAncestryRoot(
	ctx: ExtensionContext,
	fleet: AgentFleet,
	machine?: string,
	signal?: AbortSignal,
) {
	const root = rootIdentity(ctx, fleet);
	const matches = [];
	for (const entry of await fleet.snapshots(machine ?? root.machine)) {
		if (!entry.snapshot) continue;
		const runtime = fleet.connected(entry.id);
		const identity = await runtime.client.machineIdentity();
		if (identity.session !== root.machine) continue;
		for (const panel of entry.snapshot.agents) {
			if (panel.agent !== "pi" || sessionPath(panel) !== root.sessionFile)
				continue;
			try {
				if (
					(await nativeAgentName(runtime.client, panel, signal)) ===
					`/${root.sessionId}`
				)
					matches.push({ runtime, target: panel.pane_id });
			} catch {
				signal?.throwIfAborted();
			}
		}
	}
	if (matches.length !== 1)
		throw new Error(
			"No unique live /root in this spawn ancestry; use find for an exact target",
		);
	return matches[0]!;
}
