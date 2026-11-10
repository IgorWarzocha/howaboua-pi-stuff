import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { getSnapshot, sessionPath } from "./core/agents.js";
import type { AgentFleet } from "./fleet/index.js";
import type { PaneInfo } from "./types.js";

export const ENTRY = "herdr-owned-worker-v2";
const Ownership = Type.Object({
	workerId: Type.String(),
	scope: Type.String(),
	key: Type.String(),
	requestId: Type.String(),
	lifetime: Type.Union([Type.Literal("parent"), Type.Literal("detached")]),
	parent: Type.String(),
	host: Type.String(),
	session: Type.String(),
	target: Type.String(),
	terminal: Type.String(),
	sessionPath: Type.String(),
	cwd: Type.String(),
});
export type OwnedWorker = Static<typeof Ownership>;

export function records(ctx: ExtensionContext): OwnedWorker[] {
	const workers = new Map<string, OwnedWorker>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
		const value: unknown = entry.data;
		if (!Check(Ownership, value))
			throw new Error(
				"Saved worker ownership is invalid; inspect the session before retrying",
			);
		const worker = value;
		if (worker.parent === ctx.sessionManager.getSessionFile())
			workers.set(worker.workerId, worker);
	}
	return [...workers.values()];
}

export async function panelFor(
	fleet: AgentFleet,
	worker: OwnedWorker,
): Promise<PaneInfo | undefined> {
	const snapshot = await getSnapshot(fleet.connected().client);
	if (
		snapshot.agents.some(
			(value) =>
				value.pane_id !== worker.target &&
				sessionPath(value) === worker.sessionPath,
		)
	)
		throw new Error(
			"Worker session is open in another pane; refusing to control it",
		);
	const panel = snapshot.agents.find(
		(value) => value.pane_id === worker.target,
	);
	if (panel) {
		if (
			panel.pane_id === process.env["HC_TERMINAL_ID"] ||
			panel.terminal_id !== worker.terminal ||
			panel.agent !== "pi" ||
			sessionPath(panel) !== worker.sessionPath
		)
			throw new Error("Worker pane identity changed; refusing to control it");
		return panel;
	}
	if (
		snapshot.agents.some((value) => sessionPath(value) === worker.sessionPath)
	)
		throw new Error(
			"Worker session is open in another pane; refusing to control it",
		);
	return undefined;
}
