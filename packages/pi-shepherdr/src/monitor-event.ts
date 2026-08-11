import { isAgentStatus } from "./activity.js";
import type { AgentStatus, HerdrEvent } from "./types.js";

export type MonitorEvent =
	| { paneId: string; type: "closed" }
	| {
			pane: { pane_id: string; tab_id?: string; workspace_id?: string };
			previousPaneId: string;
			type: "moved";
	  }
	| {
			blockedMessage?: string;
			paneId: string;
			status: AgentStatus;
			type: "status";
	  };

function blockedReason(data: Record<string, unknown>): string | undefined {
	const labels = data["state_labels"];
	if (
		typeof labels === "object" &&
		labels !== null &&
		"blocked" in labels &&
		typeof labels.blocked === "string"
	) {
		return labels.blocked;
	}
	return typeof data["title"] === "string" ? data["title"] : undefined;
}

export function parseMonitorEvent(event: HerdrEvent): MonitorEvent | undefined {
	const paneId = event.data["pane_id"];
	if (event.event === "pane.closed") {
		if (typeof paneId !== "string") {
			throw new Error("Herdr pane.closed event has no pane_id");
		}
		return { paneId, type: "closed" };
	}
	if (event.event === "pane.agent_status_changed") {
		const status = event.data["agent_status"];
		if (typeof paneId !== "string" || !isAgentStatus(status)) {
			throw new Error("Herdr pane.agent_status_changed event is invalid");
		}
		const blockedMessage =
			status === "blocked" ? blockedReason(event.data) : undefined;
		return {
			paneId,
			status,
			type: "status",
			...(blockedMessage ? { blockedMessage } : {}),
		};
	}
	if (event.event !== "pane.moved") return undefined;
	const previousPaneId = event.data["previous_pane_id"];
	const pane = event.data["pane"];
	if (
		typeof previousPaneId !== "string" ||
		typeof pane !== "object" ||
		pane === null ||
		!("pane_id" in pane) ||
		typeof pane.pane_id !== "string"
	) {
		throw new Error("Herdr pane.moved event is invalid");
	}
	if (
		("workspace_id" in pane && typeof pane.workspace_id !== "string") ||
		("tab_id" in pane && typeof pane.tab_id !== "string")
	) {
		throw new Error("Herdr pane.moved event has invalid location IDs");
	}
	return {
		pane: {
			pane_id: pane.pane_id,
			...("workspace_id" in pane && typeof pane.workspace_id === "string"
				? { workspace_id: pane.workspace_id }
				: {}),
			...("tab_id" in pane && typeof pane.tab_id === "string"
				? { tab_id: pane.tab_id }
				: {}),
		},
		previousPaneId,
		type: "moved",
	};
}
