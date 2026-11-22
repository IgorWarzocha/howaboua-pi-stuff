import {
	summarizeShellCommand,
	type CommandSummary,
	type ShellAction,
} from "../../shell/summary.ts";

export type ExecCommandStatus = "running" | "done";

export type ExecOutcome =
	| { kind: "no-matches"; exitCode: 1 }
	| { kind: "nonzero"; exitCode: number };

export interface ExecExplorationCall {
	actions: ShellAction[];
	command: string;
	outcome?: ExecOutcome | undefined;
}

export interface ExecCommandRenderInfo {
	hidden: boolean;
	status: ExecCommandStatus;
	outcome?: ExecOutcome | undefined;
	exploration?: ExecExplorationCall[] | undefined;
}

// Exit 1 is only a no-match candidate for a bare search, not a compound
// command or an arbitrary command the display summary happens to call Search.
const BARE_SEARCH =
	/^(?:rg|grep|git[ \t]+grep)(?:[ \t]+(?:[\w./:@%+=,-]+|'[^'\r\n]*'|"[^"$\\`!\r\n]*"))+[ \t]*$/;

export function getExecOutcome(
	command: string,
	result: {
		output: string;
		exit_code?: number | undefined;
		truncated?: true | undefined;
	},
): ExecOutcome | undefined {
	const exitCode = result.exit_code;
	if (typeof exitCode !== "number" || exitCode === 0) return undefined;
	if (
		exitCode === 1 &&
		result.output === "" &&
		!result.truncated &&
		BARE_SEARCH.test(command.trim()) &&
		summarizeShellCommand(command).actions[0]?.kind === "search"
	)
		return { kind: "no-matches", exitCode };
	return { kind: "nonzero", exitCode };
}

interface ExecEntry {
	toolCallId: string;
	command: string;
	summary: CommandSummary;
	status: ExecCommandStatus;
	outcome?: ExecOutcome | undefined;
	hidden: boolean;
	groupId?: number | undefined;
	invalidate?: () => void | undefined;
}

interface ExecGroup {
	id: number;
	entryIds: string[];
	visibleEntryId: string;
}

export interface ExecCommandTracker {
	getState(command: string): ExecCommandStatus;
	getRenderInfo(
		toolCallId: string | undefined,
		command: string,
	): ExecCommandRenderInfo;
	registerRenderContext(
		toolCallId: string | undefined,
		invalidate: () => void,
	): void;
	recordStart(toolCallId: string, command: string): void;
	recordPersistentSession(toolCallId: string, sessionId: number): void;
	recordOutcome(toolCallId: string, outcome: ExecOutcome | undefined): void;
	recordEnd(toolCallId: string): void;
	recordSessionFinished(sessionId: number): void;
	resetExplorationGroup(): void;
	clear(): void;
}

export function createExecCommandTracker(): ExecCommandTracker {
	const commandByToolCallId = new Map<string, string>();
	const runningCountsByCommand = new Map<string, number>();
	const sessionBackedToolCallIds = new Set<string>();
	const toolCallIdBySessionId = new Map<number, string>();
	const entriesByToolCallId = new Map<string, ExecEntry>();
	const groupsById = new Map<number, ExecGroup>();
	let activeExplorationGroupId: number | undefined;
	let nextGroupId = 1;

	function incrementCommand(command: string): void {
		runningCountsByCommand.set(
			command,
			(runningCountsByCommand.get(command) ?? 0) + 1,
		);
	}

	function decrementCommand(command: string): void {
		const next = (runningCountsByCommand.get(command) ?? 0) - 1;
		if (next > 0) {
			runningCountsByCommand.set(command, next);
			return;
		}
		runningCountsByCommand.delete(command);
	}

	function invalidateToolCall(toolCallId: string | undefined): void {
		if (!toolCallId) return;
		entriesByToolCallId.get(toolCallId)?.invalidate?.();
	}

	function getGroupForEntry(
		entry: ExecEntry | undefined,
	): ExecGroup | undefined {
		if (!entry?.groupId) return undefined;
		return groupsById.get(entry.groupId);
	}

	function getVisibleEntry(
		group: ExecGroup | undefined,
	): ExecEntry | undefined {
		if (!group) return undefined;
		return entriesByToolCallId.get(group.visibleEntryId);
	}

	return {
		getState(command) {
			return (runningCountsByCommand.get(command) ?? 0) > 0
				? "running"
				: "done";
		},
		getRenderInfo(toolCallId, command) {
			if (!toolCallId) {
				return {
					hidden: false,
					status:
						(runningCountsByCommand.get(command) ?? 0) > 0 ? "running" : "done",
				};
			}

			const entry = entriesByToolCallId.get(toolCallId);
			if (!entry) {
				return {
					hidden: false,
					status:
						(runningCountsByCommand.get(command) ?? 0) > 0 ? "running" : "done",
				};
			}

			if (entry.hidden) {
				return { hidden: true, status: entry.status };
			}

			const group = getGroupForEntry(entry);
			if (!group) {
				return {
					hidden: false,
					status: entry.status,
					outcome: entry.outcome,
				};
			}

			const entries = group.entryIds
				.map((groupEntryId) => entriesByToolCallId.get(groupEntryId))
				.filter((groupEntry): groupEntry is ExecEntry => Boolean(groupEntry));
			return {
				hidden: false,
				status: entries.some((groupEntry) => groupEntry.status === "running")
					? "running"
					: "done",
				outcome: entry.outcome,
				exploration: entries.map((groupEntry) => ({
					actions: groupEntry.summary.actions,
					command: groupEntry.command,
					outcome: groupEntry.outcome,
				})),
			};
		},
		registerRenderContext(toolCallId, invalidate) {
			if (!toolCallId) return;
			const entry = entriesByToolCallId.get(toolCallId);
			if (!entry) return;
			entry.invalidate = invalidate;
		},
		recordStart(toolCallId, command) {
			commandByToolCallId.set(toolCallId, command);
			incrementCommand(command);

			const summary = summarizeShellCommand(command);
			const entry: ExecEntry = {
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

			let group = activeExplorationGroupId
				? groupsById.get(activeExplorationGroupId)
				: undefined;
			if (!group) {
				group = {
					id: nextGroupId++,
					entryIds: [toolCallId],
					visibleEntryId: toolCallId,
				};
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
			if (!entry) return;
			entry.status = "running";
			const group = getGroupForEntry(entry);
			invalidateToolCall(group?.visibleEntryId ?? entry.toolCallId);
		},
		recordEnd(toolCallId) {
			const command = commandByToolCallId.get(toolCallId);
			if (!command) return;
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
		recordOutcome(toolCallId, outcome) {
			const entry = entriesByToolCallId.get(toolCallId);
			if (entry) entry.outcome = outcome;
		},
		recordSessionFinished(sessionId) {
			const toolCallId = toolCallIdBySessionId.get(sessionId);
			if (!toolCallId) return;
			toolCallIdBySessionId.delete(sessionId);
			const entry = entriesByToolCallId.get(toolCallId);
			if (!entry) return;
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
