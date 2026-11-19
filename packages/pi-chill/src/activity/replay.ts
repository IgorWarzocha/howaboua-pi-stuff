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
	let inTurn = false;
	let customKickoff: ActivityGroup | undefined;
	for (const entry of entries) {
		const time = Date.parse(entry.timestamp);
		if (Number.isFinite(time)) endedAt = time;
		if (
			entry.type === "custom" &&
			activityEntryTypes.some((type) => type === entry.customType)
		) {
			if (inTurn)
				timeline.current ??= new ActivityGroup(startedAt ?? endedAt, true);
			timeline.addEntry(entry, true);
			continue;
		}
		if (entry.type === "custom_message") {
			customKickoff = undefined;
			if (
				entry.display &&
				activityMessageTypes.some((type) => type === entry.customType)
			) {
				if (inTurn)
					timeline.current ??= new ActivityGroup(startedAt ?? endedAt, true);
				const group = timeline.addMessage(
					{ ...entry, timestamp: endedAt },
					true,
					entry.id,
				);
				if (!inTurn) customKickoff = group;
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			customKickoff = undefined;
			timeline.userStarted();
			inTurn = true;
			startedAt = endedAt;
		} else if (message.role === "assistant") {
			// Delivery mode is not stored. Only the last custom message before a
			// reply can stand in for an unrecorded kickoff, never older idle rows.
			if (customKickoff) {
				timeline.current = customKickoff;
				timeline.start();
				customKickoff = undefined;
			}
			inTurn = true;
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
				inTurn = false;
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
		} else {
			customKickoff = undefined;
		}
	}
	timeline.finish(
		endedAt,
		timeline.current?.calls.length ? "interrupted" : "completed",
	);
}
