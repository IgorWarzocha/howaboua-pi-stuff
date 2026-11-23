// Retained only so old session entries remain display-only during replay.
export const EXECUTION_MODE_SESSION_ENTRY =
	"pi-codex-conversion-execution-mode";

export type ExecutionMode = "normal" | "code" | "ts" | "vm";

export const EXECUTION_MODE_LABELS = {
	normal: "Structured",
	code: "Code",
	vm: "VM Code",
	ts: "TS Notebook",
} as const satisfies Record<ExecutionMode, string>;

export function executionModeFromLabel(label: string): ExecutionMode {
	for (const mode of Object.keys(EXECUTION_MODE_LABELS) as ExecutionMode[])
		if (EXECUTION_MODE_LABELS[mode] === label) return mode;
	return "normal";
}

export function normalizeExecutionMode(
	value: unknown,
): ExecutionMode | undefined {
	if (value === "notebook") return "ts";
	if (value === "js") return "vm";
	return value === "normal" ||
		value === "code" ||
		value === "ts" ||
		value === "vm"
		? value
		: undefined;
}
