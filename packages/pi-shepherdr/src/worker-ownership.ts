import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	compile,
	lit,
	obj,
	type Static,
	str,
	union,
} from "@earendil-works/pi-schema";
import { getSnapshot, sessionPath } from "./core/agents.js";
import type { AgentFleet } from "./fleet/index.js";
import type { PaneInfo } from "./types.js";

export const ENTRY = "herdr-owned-worker-v2";
const Ownership = obj(
	{
		workerId: str(),
		scope: str(),
		key: str(),
		requestId: str(),
		lifetime: union([
			{
				...lit("parent"),
				type: "string",
			},
			{
				...lit("detached"),
				type: "string",
			},
		]),
		parent: str(),
		host: str(),
		session: str(),
		target: str(),
		terminal: str(),
		sessionPath: str(),
		cwd: str(),
	},
	{ open: true },
);
const checkOwnership = compile(Ownership).check;
export type OwnedWorker = Static<typeof Ownership>;

export function records(ctx: ExtensionContext): OwnedWorker[] {
	const workers = new Map<string, OwnedWorker>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
		const value: unknown = entry.data;
		if (!checkOwnership(value))
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
