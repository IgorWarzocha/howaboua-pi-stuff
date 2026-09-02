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

function legacyActivity(
	record: Record<string, unknown>,
): AgentActivity | undefined {
	if (!isAgentStatus(record["lastStatus"])) return undefined;
	const task = optionalString(record, "task");
	if (task === false) return undefined;
	if (record["lastStatus"] === "working") {
		return { phase: "working", ...(task ? { task } : {}) };
	}
	if (!task) return { phase: "settled", status: record["lastStatus"] };
	return {
		attemptId: `restored:${String(record["terminalId"])}`,
		phase: "submitting",
		previous: { phase: "settled", status: record["lastStatus"] },
		task,
	};
}

export function parseMonitoredAgent(
	value: unknown,
): MonitoredAgent | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (
		typeof record["paneId"] !== "string" ||
		typeof record["terminalId"] !== "string" ||
		typeof record["workspaceId"] !== "string" ||
		typeof record["tabId"] !== "string"
	) {
		return undefined;
	}
	const cwd = optionalString(record, "cwd");
	const lastAssistantId = optionalString(record, "lastAssistantId");
	const name = optionalString(record, "name");
	const activity = parsedActivity(record["activity"]) ?? legacyActivity(record);
	if (
		cwd === false ||
		lastAssistantId === false ||
		name === false ||
		!activity
	) {
		return undefined;
	}
	return {
		activity,
		paneId: record["paneId"],
		terminalId: record["terminalId"],
		workspaceId: record["workspaceId"],
		tabId: record["tabId"],
		...(cwd ? { cwd } : {}),
		...(lastAssistantId ? { lastAssistantId } : {}),
		...(name ? { name } : {}),
	};
}

export function recordForPanel(
	panel: PaneInfo,
	activity: AgentActivity,
	lastAssistantId?: string,
): MonitoredAgent {
	const cwd = panel.foreground_cwd ?? panel.cwd;
	return {
		activity,
		paneId: panel.pane_id,
		terminalId: panel.terminal_id,
		workspaceId: panel.workspace_id,
		tabId: panel.tab_id,
		...(panel.name ? { name: panel.name } : {}),
		...(cwd ? { cwd } : {}),
		...(lastAssistantId ? { lastAssistantId } : {}),
	};
}

export function sameMonitorRecord(
	left: MonitoredAgent,
	right: MonitoredAgent,
): boolean {
	return (
		left.paneId === right.paneId &&
		left.terminalId === right.terminalId &&
		left.workspaceId === right.workspaceId &&
		left.tabId === right.tabId &&
		left.cwd === right.cwd &&
		left.name === right.name &&
		left.lastAssistantId === right.lastAssistantId &&
		sameAgentActivity(left.activity, right.activity)
	);
}
