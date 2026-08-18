export type NotebookRuntimeHealthState = "not_started" | "ready" | "invalidated";

export interface NotebookRuntimeHealth {
	state: NotebookRuntimeHealthState;
}

export const NOTEBOOK_INTERRUPTED_NOTICE =
	"Notebook runtime was invalidated by an interrupted cell. The next operation will recreate it from the last completed checkpoint; durable project bindings were preserved. External side effects were not rolled back";

export const NOTEBOOK_BOOTSTRAP_NOTICE =
	"Notebook runtime bootstrap was unavailable. The kernel was discarded; the next operation will recreate it from the last completed checkpoint. Durable project bindings were preserved";

export const NOTEBOOK_KERNEL_FAILURE_NOTICE =
	"Notebook runtime became unavailable during a host operation. The next operation will recreate it from the last completed checkpoint; durable project bindings were preserved. External side effects were not rolled back";

export function isNotebookBootstrapFailure(value: unknown): boolean {
	const text = errorText(value);
	return text.includes("Notebook runtime bootstrap unavailable: __piNotebook.");
}

function errorText(value: unknown, depth = 0): string {
	if (depth > 2) return "";
	if (typeof value === "string") return value;
	if (value instanceof Error) return [value.message, errorText(value.cause, depth + 1)].filter(Boolean).join(" ");
	if (value && typeof value === "object") {
		const result = value as Record<string, unknown>;
		return [
			typeof result["errorText"] === "string" ? result["errorText"] : undefined,
			typeof result["errorName"] === "string" ? result["errorName"] : undefined,
			typeof result["errorValue"] === "string" ? result["errorValue"] : undefined,
			errorText(result["cause"], depth + 1),
		].filter(Boolean).join(" ");
	}
	return "";
}
