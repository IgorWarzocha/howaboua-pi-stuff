import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOCAL_MACHINE } from "../machine-catalog.js";
export const MONITOR_STATE_TYPE = "herdr-agents-monitor-state";

export function savedAgents(ctx: ExtensionContext): unknown[] {
	let latest: unknown[] = [];
	let version: unknown;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== MONITOR_STATE_TYPE)
			continue;
		const data = entry.data as { version?: unknown; agents?: unknown };
		if (Array.isArray(data?.agents)) {
			latest = data.agents;
			version = data.version;
		}
	}
	if (latest.length > 0 && version !== 2) {
		ctx.ui.notify(
			"Cleared legacy Shepherdr watches; use watch to subscribe explicitly. Remote agents are unchanged.",
			"warning",
		);
		return [];
	}
	return latest;
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
