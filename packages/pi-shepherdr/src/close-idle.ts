import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CoreConnection } from "./core/backend.js";
import type { AgentFleet } from "./fleet/index.js";
import { getSnapshot, sessionPath } from "./herdr.js";
import { spawnedChildren } from "./spawn-ownership.js";

export async function closeIdleChildren(
	fleet: AgentFleet,
	ctx: ExtensionContext,
	current: () => boolean,
): Promise<string> {
	let closed = 0;
	let skipped = 0;
	const failures: string[] = [];
	for (const child of spawnedChildren(ctx)) {
		if (!current()) break;
		try {
			const status = fleet
				.statuses()
				.find((value) => value.id === child.machine);
			if (!status || status.status !== "connected" || status.monitoringIssue) {
				skipped += 1;
				continue;
			}
			const runtime = fleet.connected(child.machine);
			const identity = await runtime.client.machineIdentity();
			const snapshot = await getSnapshot(runtime.client);
			const panel = snapshot.agents.find(
				(value) => value.pane_id === child.pane,
			);
			const record = runtime.monitor
				.list()
				.find((value) => value.terminalId === child.terminal);
			if (
				!current() ||
				!spawnedChildren(ctx).some(
					(value) =>
						value.machine === child.machine &&
						value.pane === child.pane &&
						value.terminal === child.terminal &&
						value.sessionFile === child.sessionFile,
				) ||
				identity.host !== child.host ||
				identity.session !== child.session ||
				!panel ||
				panel.agent !== "pi" ||
				panel.terminal_id !== child.terminal ||
				sessionPath(panel) !== child.sessionFile ||
				(runtime.local &&
					panel.pane_id ===
						process.env[
							runtime.client instanceof CoreConnection
								? "HC_TERMINAL_ID"
								: "HERDR_PANE_ID"
						]) ||
				snapshot.agents.some(
					(value) =>
						value.pane_id !== child.pane &&
						sessionPath(value) === child.sessionFile,
				) ||
				panel.interactive_ready !== true ||
				panel.launch_pending === true ||
				(panel.agent_status !== "idle" && panel.agent_status !== "done") ||
				!record ||
				record.paneId !== child.pane ||
				record.activity.phase !== "settled" ||
				(record.activity.status !== "idle" && record.activity.status !== "done")
			) {
				skipped += 1;
				continue;
			}
			await runtime.client.sendMessage(panel, {
				text: "/quit",
				sender: '<herdr_sender kind="idle-close" />',
				closeIfIdle: true,
			});
			closed += 1;
		} catch (error) {
			skipped += 1;
			failures.push(
				`${child.machine}:${child.pane}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return [
		`Closed ${closed} idle child sessions; skipped ${skipped}.`,
		...failures,
	].join("\n");
}
