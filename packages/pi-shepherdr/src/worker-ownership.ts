import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CoreConnection } from "./core/backend.js";
import type { AgentFleet } from "./fleet/index.js";
import { getSnapshot, sessionPath } from "./herdr.js";
import type { PaneInfo } from "./types.js";

export const ENTRY = "herdr-owned-worker-v1";

export interface OwnedWorker {
	workerId: string;
	pulseId: string;
	runId: string;
	parent: string;
	host: string;
	session: string;
	target: string;
	terminal: string;
	sessionPath: string;
	cwd: string;
}

export function records(ctx: ExtensionContext): OwnedWorker[] {
	const workers = new Map<string, OwnedWorker>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
		const value = entry.data as Record<string, unknown> | undefined;
		if (
			!value ||
			![
				"workerId",
				"pulseId",
				"runId",
				"parent",
				"host",
				"session",
				"target",
				"terminal",
				"sessionPath",
				"cwd",
			].every((key) => typeof value[key] === "string")
		)
			throw new Error(
				"Saved pulse worker ownership is invalid; inspect the session before retrying",
			);
		const worker = value as unknown as OwnedWorker;
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
			panel.pane_id ===
				process.env[
					fleet.connected().client instanceof CoreConnection
						? "HC_TERMINAL_ID"
						: "HERDR_PANE_ID"
				] ||
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
