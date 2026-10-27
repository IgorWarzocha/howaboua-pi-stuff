import type { MessageRenderer } from "@earendil-works/pi-coding-agent";

type CustomMessage = Parameters<MessageRenderer>[0];
export type ActivityMessage = Pick<
	CustomMessage,
	"customType" | "content" | "timestamp" | "details"
>;

// Opt-in display policy, not a protocol registry. Add a type only when its full
// body remains recoverable; unknown notices should keep their native presentation.
export const activityMessageTypes = [
	"herdr-agent-message",
	"herdr-agent-event",
	"subdir-agents-context",
	"codex-developer-message",
	"codex-context-window",
] as const;

export const activityEntryTypes = [
	"codex-notebook-status",
	"codex-toolkit-update",
	"codex-native-compaction-display",
] as const;

/** Code/Notebook Mode can report script and nested errors in successful outer results. */
export function hasCodeModeError(details: unknown): boolean {
	if (
		!details ||
		typeof details !== "object" ||
		!("codeMode" in details) ||
		details.codeMode !== true
	)
		return false;
	if (
		"scriptError" in details &&
		typeof details.scriptError === "string" &&
		details.scriptError.length > 0
	)
		return true;
	return (
		"traces" in details &&
		Array.isArray(details.traces) &&
		details.traces.some(
			(trace: unknown) =>
				trace !== null &&
				typeof trace === "object" &&
				"status" in trace &&
				trace.status === "error",
		)
	);
}
