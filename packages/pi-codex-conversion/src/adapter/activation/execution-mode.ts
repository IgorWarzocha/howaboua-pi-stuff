// Retained only so old session entries remain display-only during replay.
export const EXECUTION_MODE_SESSION_ENTRY =
	"pi-codex-conversion-execution-mode";

export type ExecutionMode = "normal" | "code" | "ts" | "vm";

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
