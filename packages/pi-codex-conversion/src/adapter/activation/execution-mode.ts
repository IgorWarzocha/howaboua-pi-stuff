// Retained only so old session entries remain display-only during replay.
export const EXECUTION_MODE_SESSION_ENTRY =
	"pi-codex-conversion-execution-mode";

export type ExecutionMode = "normal" | "code" | "ts" | "js" | "vm";

export function normalizeExecutionMode(
	value: unknown,
): ExecutionMode | undefined {
	if (value === "notebook") return "ts";
	return value === "normal" ||
		value === "code" ||
		value === "ts" ||
		value === "js" ||
		value === "vm"
		? value
		: undefined;
}
