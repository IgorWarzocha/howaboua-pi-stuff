import { isAgentStatus, sameAgentActivity } from "./activity.js";
import type {
	AgentActivity,
	MonitoredAgent,
	PaneInfo,
	StableAgentActivity,
} from "./types.js";

function optionalString(
	value: Record<string, unknown>,
	field: string,
): string | undefined | false {
	const candidate = value[field];
	return candidate === undefined || typeof candidate === "string"
		? candidate
		: false;
}

function optionalNullableString(
	value: Record<string, unknown>,
	field: string,
): string | null | undefined | false {
	const candidate = value[field];
	return candidate === undefined ||
		candidate === null ||
		typeof candidate === "string"
		? candidate
		: false;
}

function stableActivity(value: unknown): StableAgentActivity | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const activity = value as Record<string, unknown>;
	if (
		activity["phase"] === "settled" &&
		isAgentStatus(activity["status"]) &&
		activity["status"] !== "working"
	) {
		return { phase: "settled", status: activity["status"] };
	}
	if (activity["phase"] !== "working") return undefined;
	const task = optionalString(activity, "task");
	const attemptId = optionalString(activity, "attemptId");
	const expectedUserAfter = optionalNullableString(
		activity,
		"expectedUserAfter",
	);
	return task === false
		? undefined
		: attemptId === false
			? undefined
			: expectedUserAfter === false ||
					(expectedUserAfter !== undefined && !task)
				? undefined
				: {
						phase: "working",
						...(attemptId ? { attemptId } : {}),
						...(expectedUserAfter !== undefined ? { expectedUserAfter } : {}),
						...(task ? { task } : {}),
					};
}

function parsedActivity(value: unknown): AgentActivity | undefined {
	const stable = stableActivity(value);
	if (stable) return stable;
	if (typeof value !== "object" || value === null) return undefined;
	const activity = value as Record<string, unknown>;
	const previous = stableActivity(activity["previous"]);
	const expectedUserAfter = optionalNullableString(
		activity,
		"expectedUserAfter",
	);
	if (
		activity["phase"] !== "submitting" ||
		typeof activity["attemptId"] !== "string" ||
		typeof activity["task"] !== "string" ||
		expectedUserAfter === false ||
		!previous
	) {
		return undefined;
	}
	return {
		attemptId: activity["attemptId"],
		phase: "submitting",
		previous,
		task: activity["task"],
		...(expectedUserAfter !== undefined ? { expectedUserAfter } : {}),
	};
}

export function parseMonitoredAgent(
	value: unknown,
): MonitoredAgent | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (
		(record["scope"] !== "task" && record["scope"] !== "persistent") ||
		typeof record["paneId"] !== "string" ||
		typeof record["terminalId"] !== "string" ||
		(record["workspaceId"] !== undefined &&
			typeof record["workspaceId"] !== "string") ||
		(record["tabId"] !== undefined && typeof record["tabId"] !== "string")
	) {
		return undefined;
	}
	const cwd = optionalString(record, "cwd");
	const lastAssistantId = optionalString(record, "lastAssistantId");
	const notifiedExtensionMessages =
		record["notifiedExtensionMessages"] === undefined
			? undefined
			: Array.isArray(record["notifiedExtensionMessages"]) &&
					record["notifiedExtensionMessages"].every(
						(value) => typeof value === "string",
					)
				? (record["notifiedExtensionMessages"] as string[])
				: false;
	const name = optionalString(record, "name");
	const instructions = optionalString(record, "instructions");
	const activity = parsedActivity(record["activity"]);
	if (
		cwd === false ||
		lastAssistantId === false ||
		notifiedExtensionMessages === false ||
		name === false ||
		instructions === false ||
		!activity
	) {
		return undefined;
	}
	return {
		scope: record["scope"],
		...(instructions ? { instructions } : {}),
		activity,
		paneId: record["paneId"],
		terminalId: record["terminalId"],
		...(record["workspaceId"] !== undefined
			? { workspaceId: record["workspaceId"] }
			: {}),
		...(record["tabId"] !== undefined ? { tabId: record["tabId"] } : {}),
		...(cwd ? { cwd } : {}),
		...(lastAssistantId ? { lastAssistantId } : {}),
		...(notifiedExtensionMessages ? { notifiedExtensionMessages } : {}),
		...(name ? { name } : {}),
	};
}

export function recordForPanel(
	panel: PaneInfo,
	activity: AgentActivity,
	scope: MonitoredAgent["scope"],
	lastAssistantId?: string,
	notifiedExtensionMessages?: string[],
): MonitoredAgent {
	const cwd = panel.foreground_cwd ?? panel.cwd;
	return {
		scope,
		activity,
		paneId: panel.pane_id,
		terminalId: panel.terminal_id,
		...(panel.workspace_id ? { workspaceId: panel.workspace_id } : {}),
		...(panel.tab_id ? { tabId: panel.tab_id } : {}),
		...(panel.name ? { name: panel.name } : {}),
		...(cwd ? { cwd } : {}),
		...(lastAssistantId ? { lastAssistantId } : {}),
		...(notifiedExtensionMessages ? { notifiedExtensionMessages } : {}),
	};
}

export function sameMonitorRecord(
	left: MonitoredAgent,
	right: MonitoredAgent,
): boolean {
	return (
		left.scope === right.scope &&
		left.instructions === right.instructions &&
		left.paneId === right.paneId &&
		left.terminalId === right.terminalId &&
		left.workspaceId === right.workspaceId &&
		left.tabId === right.tabId &&
		left.cwd === right.cwd &&
		left.name === right.name &&
		left.lastAssistantId === right.lastAssistantId &&
		JSON.stringify(left.notifiedExtensionMessages) ===
			JSON.stringify(right.notifiedExtensionMessages) &&
		sameAgentActivity(left.activity, right.activity)
	);
}
