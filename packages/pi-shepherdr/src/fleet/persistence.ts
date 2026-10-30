import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOCAL_MACHINE } from "../machine-catalog.js";
export const MONITOR_STATE_TYPE = "herdr-agents-monitor-state";

export function savedAgents(
	ctx: ExtensionContext,
	localCoreId?: string,
): unknown[] {
	let latest: unknown[] = [];
	let version: unknown;
	let savedCoreId: unknown;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== MONITOR_STATE_TYPE)
			continue;
		const data = entry.data as {
			version?: unknown;
			agents?: unknown;
			localCoreId?: unknown;
		};
		if (Array.isArray(data?.agents)) {
			latest = data.agents;
			version = data.version;
			savedCoreId = data.localCoreId;
		}
	}
	if (latest.length > 0 && version !== 2) {
		ctx.ui.notify(
			"Cleared legacy Shepherdr watches; use watch to subscribe explicitly. Remote agents are unchanged.",
			"warning",
		);
		return [];
	}
	if (savedCoreId === localCoreId) return latest;
	const retained = latest.filter(
		(value) =>
			typeof value === "object" &&
			value !== null &&
			"machine" in value &&
			typeof value.machine === "string" &&
			value.machine !== LOCAL_MACHINE,
	);
	if (retained.length !== latest.length)
		ctx.ui.notify(
			"Ignored saved local agent watches from another Herdr session; watch them again in this session.",
			"warning",
		);
	return retained;
}

export function groupSaved(values: unknown[]): Map<string, unknown[]> {
	const grouped = new Map<string, unknown[]>();
	for (const value of values) {
		const machine =
			typeof value === "object" &&
			value !== null &&
			"machine" in value &&
			typeof value.machine === "string"
				? value.machine
				: LOCAL_MACHINE;
		const records = grouped.get(machine) ?? [];
		records.push(value);
		grouped.set(machine, records);
	}
	return grouped;
}
