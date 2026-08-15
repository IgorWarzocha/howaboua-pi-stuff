// Retained only so old session entries remain display-only during replay.
export const EXECUTION_MODE_SESSION_ENTRY = "pi-codex-conversion-execution-mode";

export type ExecutionMode = "normal" | "code" | "notebook";

export function normalizeExecutionMode(value: unknown): ExecutionMode | undefined {
	return value === "normal" || value === "code" || value === "notebook"
		? value
		: undefined;
}
