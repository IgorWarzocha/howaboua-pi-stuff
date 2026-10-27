import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { ActivityGroup } from "./group.js";
import {
	activityEntryTypes,
	activityMessageTypes,
	hasCodeModeError,
} from "./policy.js";
import type { ActivityTimeline } from "./timeline.js";

/** Replays selected branch evidence through the same live group transitions. */
export function replayActivity(
	timeline: ActivityTimeline,
	entries: readonly SessionEntry[],
): void {
	let startedAt: number | undefined;
	let endedAt = 0;
	for (const entry of entries) {
		const time = Date.parse(entry.timestamp);
		if (Number.isFinite(time)) endedAt = time;
		if (
			entry.type === "custom" &&
			activityEntryTypes.some((type) => type === entry.customType)
		) {
			timeline.current ??= new ActivityGroup(startedAt ?? endedAt, true);
			timeline.addEntry(entry);
			continue;
		}
		if (
			entry.type === "custom_message" &&
			entry.display &&
			activityMessageTypes.some((type) => type === entry.customType)
		) {
			timeline.current ??= new ActivityGroup(startedAt ?? endedAt, true);
			timeline.addMessage({ ...entry, timestamp: endedAt }, true, entry.id);
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			timeline.userStarted();
			startedAt = endedAt;
		} else if (message.role === "assistant") {
			timeline.assistantStarted();
			timeline.assistantUpdated(message.content);
			const tools = message.content.filter(
				(block) => block.type === "toolCall",
			);
			if (tools.length) {
				timeline.current ??= new ActivityGroup(startedAt ?? endedAt, true);
				for (const tool of tools) {
					if (tool.name === "new_context") continue;
					timeline.add(tool.id, tool.name);
					timeline.current.stage.start(tool.id, tool.name, tool.arguments);
				}
			}
			const interrupted =
				message.stopReason === "aborted" ||
				message.stopReason === "error" ||
				message.stopReason === "length";
			if (
				interrupted ||
				(tools.length === 0 && message.stopReason !== "toolUse")
			) {
				timeline.finish(
					endedAt,
					message.stopReason === "stop" ? "completed" : "interrupted",
				);
				startedAt = undefined;
			}
		} else if (message.role === "toolResult") {
			const member = timeline.calls.get(message.toolCallId);
			if (member) {
				member.call.status =
					message.isError || hasCodeModeError(message.details)
						? "error"
						: "done";
				member.group.stage.end(
					message.toolCallId,
					message,
					member.call.status === "error",
				);
			}
		}
	}
	timeline.finish(
		endedAt,
		timeline.current?.calls.length ? "interrupted" : "completed",
	);
}
