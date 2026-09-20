import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isCodexDeveloperMessageDetails, type CodexDeveloperMessageDetails } from "../developer-messages.ts";
import { isContextWindowBoundary, isContextWindowCompactionDetails } from "../context-management/messages.ts";

export const CODEX_CURRENT_TIME_REMINDER_TYPE = "codex-current-time-reminder";

interface CurrentTimeReminder extends CodexDeveloperMessageDetails {
	time: number;
}

function readReminder(value: unknown): CurrentTimeReminder {
	if (!isCodexDeveloperMessageDetails(value) || !("time" in value)
		|| typeof value.time !== "number" || !Number.isFinite(value.time)
		|| Number.isNaN(new Date(value.time).getTime()))
		throw new Error("Malformed persisted current time reminder");
	return value as CurrentTimeReminder;
}

export function projectCurrentTimeReminder(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || entry.customType !== CODEX_CURRENT_TIME_REMINDER_TYPE) return entry;
	const reminder = readReminder(entry.data);
	const utc = new Date(reminder.time).toISOString().slice(0, 16) + "Z";
	return { ...entry, type: "custom_message", display: false, details: reminder,
		content: `<current_time_reminder>\n${utc}\n</current_time_reminder>` };
}

/** Called only at actual inference admission, never by prewarm or a timer. */
export function recordCurrentTimeReminder(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	messages: readonly AgentMessage[],
	minutes: 0 | 30 | 60,
): boolean {
	if (minutes === 0) return false;
	const previousIndex = messages.findLastIndex((message) => message.role === "custom"
		&& message.customType === CODEX_CURRENT_TIME_REMINDER_TYPE);
	const previous = messages[previousIndex];
	const reminder = previous?.role === "custom" ? readReminder(previous.details) : undefined;
	const now = Date.now();
	if (reminder && messages.findLastIndex(isContextWindowBoundary) < previousIndex) {
		const branch = ctx.sessionManager.getBranch();
		const compacted = branch.findLastIndex((entry) => entry.type === "compaction" && !isContextWindowCompactionDetails(entry.details))
			> branch.findLastIndex((entry) => entry.type === "custom" && entry.customType === CODEX_CURRENT_TIME_REMINDER_TYPE);
		if (!compacted) {
			if (now - reminder.time < minutes * 60_000) return false;
			// Failed attempts reuse their stamp even if retries outlast the interval.
			if (!messages.slice(previousIndex + 1).some((message) => message.role === "user"
				|| (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted"))) return false;
		}
	}
	// A custom entry is durable immediately, unlike sendMessage during a live turn.
	// Developer-history projects it at this position without queuing a continuation.
	pi.appendEntry(CODEX_CURRENT_TIME_REMINDER_TYPE, { protocol: 1, id: randomUUID(), time: now } satisfies CurrentTimeReminder);
	return true;
}
