import type { PaneInfo } from "./types.js";

export const START_PLACEMENTS = [
	"new_workspace",
	"new_tab",
	"pane",
	"terminal",
] as const;

export interface StartAgentParams {
	cwd?: string;
	label?: string;
	name?: string;
	pane?: string;
	placement?: (typeof START_PLACEMENTS)[number];
	workspace?: string;
}

export interface CreatedLocationCleanup {
	id: string;
	method: "tab.close" | "workspace.close" | "terminal.close";
}

export interface StartedAgent {
	agent: PaneInfo;
	cleanup?: CreatedLocationCleanup;
	id: string;
}

export class RolledBackAgentLaunchError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

export class UnstartedAgentLaunchError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

export function requiredStartField(
	value: string | undefined,
	field: string,
): string {
	if (!value?.trim()) throw new Error(`${field} is required for start`);
	return value.trim();
}
