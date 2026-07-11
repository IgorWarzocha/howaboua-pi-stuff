import { summarizeShellCommand } from "../../shell/summary.js";
export function createExecCommandTracker() {
    const commandByToolCallId = new Map();
    const runningCountsByCommand = new Map();
    const sessionBackedToolCallIds = new Set();
    const toolCallIdBySessionId = new Map();
    const entriesByToolCallId = new Map();
    const groupsById = new Map();
    let activeExplorationGroupId;
    let nextGroupId = 1;
    function incrementCommand(command) {
        runningCountsByCommand.set(command, (runningCountsByCommand.get(command) ?? 0) + 1);
    }
    function decrementCommand(command) {
        const next = (runningCountsByCommand.get(command) ?? 0) - 1;
        if (next > 0) {
            runningCountsByCommand.set(command, next);
            return;
        }
        runningCountsByCommand.delete(command);
    }
    function invalidateToolCall(toolCallId) {
        if (!toolCallId)
            return;
        entriesByToolCallId.get(toolCallId)?.invalidate?.();
    }
    function getGroupForEntry(entry) {
        if (!entry?.groupId)
            return undefined;
        return groupsById.get(entry.groupId);
    }
    function getVisibleEntry(group) {
        if (!group)
            return undefined;
        return entriesByToolCallId.get(group.visibleEntryId);
    }
    return {
        getState(command) {
            return (runningCountsByCommand.get(command) ?? 0) > 0 ? "running" : "done";
        },
        getRenderInfo(toolCallId, command) {
            if (!toolCallId) {
                return { hidden: false, status: (runningCountsByCommand.get(command) ?? 0) > 0 ? "running" : "done" };
            }
            const entry = entriesByToolCallId.get(toolCallId);
            if (!entry) {
                return { hidden: false, status: (runningCountsByCommand.get(command) ?? 0) > 0 ? "running" : "done" };
            }
            if (entry.hidden) {
                return { hidden: true, status: entry.status };
            }
            const group = getGroupForEntry(entry);
            if (!group) {
                return {
                    hidden: false,
                    status: entry.status,
                    actionGroups: entry.summary.maskAsExplored ? [entry.summary.actions] : undefined,
                };
            }
            const entries = group.entryIds
                .map((groupEntryId) => entriesByToolCallId.get(groupEntryId))
                .filter((groupEntry) => Boolean(groupEntry));
            return {
                hidden: false,
                status: entries.some((groupEntry) => groupEntry.status === "running") ? "running" : "done",
                actionGroups: entries.map((groupEntry) => groupEntry.summary.actions),
            };
        },
        registerRenderContext(toolCallId, invalidate) {
            if (!toolCallId)
                return;
            const entry = entriesByToolCallId.get(toolCallId);
            if (!entry)
                return;
            entry.invalidate = invalidate;
        },
        recordStart(toolCallId, command) {
            commandByToolCallId.set(toolCallId, command);
            incrementCommand(command);
            const summary = summarizeShellCommand(command);
            const entry = {
                toolCallId,
                command,
                summary,
                status: "running",
                hidden: false,
            };
            entriesByToolCallId.set(toolCallId, entry);
            if (!summary.maskAsExplored) {
                activeExplorationGroupId = undefined;
                return;
            }
            let group = activeExplorationGroupId ? groupsById.get(activeExplorationGroupId) : undefined;
            if (!group) {
                group = { id: nextGroupId++, entryIds: [toolCallId], visibleEntryId: toolCallId };
                groupsById.set(group.id, group);
                activeExplorationGroupId = group.id;
                entry.groupId = group.id;
                return;
            }
            const previousVisibleEntry = getVisibleEntry(group);
            if (previousVisibleEntry) {
                previousVisibleEntry.hidden = true;
                invalidateToolCall(previousVisibleEntry.toolCallId);
            }
            group.entryIds.push(toolCallId);
            group.visibleEntryId = toolCallId;
            entry.groupId = group.id;
        },
        recordPersistentSession(toolCallId, sessionId) {
            sessionBackedToolCallIds.add(toolCallId);
            toolCallIdBySessionId.set(sessionId, toolCallId);
            const entry = entriesByToolCallId.get(toolCallId);
            if (!entry)
                return;
            entry.status = "running";
            const group = getGroupForEntry(entry);
            invalidateToolCall(group?.visibleEntryId ?? entry.toolCallId);
        },
        recordEnd(toolCallId) {
            const command = commandByToolCallId.get(toolCallId);
            if (!command)
                return;
            const entry = entriesByToolCallId.get(toolCallId);
            if (!sessionBackedToolCallIds.has(toolCallId)) {
                decrementCommand(command);
                if (entry) {
                    entry.status = "done";
                }
            }
            const group = getGroupForEntry(entry);
            invalidateToolCall(group?.visibleEntryId ?? toolCallId);
            commandByToolCallId.delete(toolCallId);
        },
        recordSessionFinished(sessionId) {
            const toolCallId = toolCallIdBySessionId.get(sessionId);
            if (!toolCallId)
                return;
            toolCallIdBySessionId.delete(sessionId);
            const entry = entriesByToolCallId.get(toolCallId);
            if (!entry)
                return;
            decrementCommand(entry.command);
            entry.status = "done";
            sessionBackedToolCallIds.delete(toolCallId);
            const group = getGroupForEntry(entry);
            invalidateToolCall(group?.visibleEntryId ?? entry.toolCallId);
        },
        resetExplorationGroup() {
            activeExplorationGroupId = undefined;
        },
        clear() {
            commandByToolCallId.clear();
            runningCountsByCommand.clear();
            sessionBackedToolCallIds.clear();
            toolCallIdBySessionId.clear();
            entriesByToolCallId.clear();
            groupsById.clear();
            activeExplorationGroupId = undefined;
            nextGroupId = 1;
        },
    };
}
