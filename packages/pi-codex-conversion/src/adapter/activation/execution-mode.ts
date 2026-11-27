// Retained only so old session entries remain display-only during replay.
export const EXECUTION_MODE_SESSION_ENTRY =
	"pi-codex-conversion-execution-mode";

export type ExecutionMode = "code" | "ts" | "vm";

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "vm";

export const EXECUTION_MODE_LABELS = {
	vm: "VM Code",
	code: "Code",
	ts: "TS Notebook",
} as const satisfies Record<ExecutionMode, string>;

export function executionModeFromLabel(label: string): ExecutionMode {
	for (const mode of Object.keys(EXECUTION_MODE_LABELS) as ExecutionMode[])
		if (EXECUTION_MODE_LABELS[mode] === label) return mode;
	return DEFAULT_EXECUTION_MODE;
}

export function normalizeExecutionMode(
	value: unknown,
): ExecutionMode | undefined {
	if (value === "notebook") return "ts";
	if (value === "js" || value === "normal") return "vm";
	return value === "code" || value === "ts" || value === "vm"
		? value
		: undefined;
}
