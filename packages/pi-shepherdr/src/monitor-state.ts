import { randomUUID } from "node:crypto";
import {
	activityForPanel,
	activityTask,
	isSettledStatus,
	sameAgentActivity,
} from "./activity.js";
import {
	parseMonitoredAgent,
	recordForPanel,
	sameMonitorRecord,
} from "./monitor-record.js";
import type {
	AgentActivity,
	AgentStatus,
	MonitoredAgent,
	PaneInfo,
	SessionSnapshot,
	SettledAgentStatus,
} from "./types.js";

export interface WorkAttempt {
	attemptId: string;
	terminalId: string;
}

interface CompletionCandidate {
	record: MonitoredAgent;
	requireNewReply: boolean;
	status: SettledAgentStatus;
	task?: string;
}

interface ReconcileResult {
	changed: boolean;
	completions: CompletionCandidate[];
	removed: MonitoredAgent[];
}

interface StatusResult {
	changed: boolean;
	completion?: CompletionCandidate;
}

export class MonitorState {
	private readonly agents = new Map<string, MonitoredAgent>();

	restore(values: unknown[], controllingPaneId?: string): number {
		this.agents.clear();
		let dropped = 0;
		for (const value of values) {
			const record = parseMonitoredAgent(value);
			if (!record) {
				dropped += 1;
				continue;
			}
			if (
				record.paneId !== controllingPaneId &&
				!this.agents.has(record.terminalId) &&
				!this.byPane(record.paneId)
			) {
				this.agents.set(record.terminalId, record);
			} else if (record.paneId !== controllingPaneId) {
				dropped += 1;
			}
		}
		return dropped;
	}

	list(): MonitoredAgent[] {
		return [...this.agents.values()];
	}

	byPane(paneId: string): MonitoredAgent | undefined {
		return this.list().find((record) => record.paneId === paneId);
	}

	byTerminal(terminalId: string): MonitoredAgent | undefined {
		return this.agents.get(terminalId);
	}

	isMonitored(paneId: string): boolean {
		return this.byPane(paneId) !== undefined;
	}

	watch(
		panel: PaneInfo,
		lastAssistantId?: string,
		reportSettled = true,
	): { record: MonitoredAgent; reportCurrent: boolean } {
		const existing =
			this.byTerminal(panel.terminal_id) ?? this.byPane(panel.pane_id);
		const reportCurrent =
			reportSettled &&
			!existing &&
			(panel.agent_status === "done" || panel.agent_status === "blocked");
		const activity = reportCurrent
			? ({ phase: "working" } as const)
			: (existing?.activity ?? activityForPanel(panel));
		const record = recordForPanel(
			panel,
			activity,
			reportCurrent
				? undefined
				: (existing?.lastAssistantId ?? lastAssistantId),
		);
		if (existing && existing.terminalId !== record.terminalId) {
			this.agents.delete(existing.terminalId);
		}
		this.agents.set(record.terminalId, record);
		return { record, reportCurrent };
	}

	removePane(paneId: string): MonitoredAgent | undefined {
		const record = this.byPane(paneId);
		if (record) this.agents.delete(record.terminalId);
		return record;
	}

	beginWork(
		paneId: string,
		task: string,
		expectedUserAfter?: string | null,
	): WorkAttempt | undefined {
		const record = this.byPane(paneId);
		if (!record) return undefined;
		if (record.activity.phase === "submitting") {
			throw new Error(
				`prompt submission to ${record.name ?? paneId} is still unresolved`,
			);
		}
		const attempt = {
			attemptId: randomUUID(),
			terminalId: record.terminalId,
		};
		this.agents.set(record.terminalId, {
			...record,
			activity: {
				attemptId: attempt.attemptId,
				phase: "submitting",
				previous: record.activity,
				task,
				...(expectedUserAfter !== undefined ? { expectedUserAfter } : {}),
			},
		});
		return attempt;
	}

	acceptWork(attempt: WorkAttempt | undefined): boolean {
		const record = attempt ? this.byTerminal(attempt.terminalId) : undefined;
		if (
			!record ||
			record.activity.phase !== "submitting" ||
			record.activity.attemptId !== attempt?.attemptId
		) {
			return false;
		}
		this.agents.set(record.terminalId, {
			...record,
			activity: {
				attemptId: record.activity.attemptId,
				...(record.activity.expectedUserAfter !== undefined
					? { expectedUserAfter: record.activity.expectedUserAfter }
					: {}),
				phase: "working",
				task: record.activity.task,
			},
		});
		return true;
	}

	rejectWork(attempt: WorkAttempt | undefined): boolean {
		const record = attempt ? this.byTerminal(attempt.terminalId) : undefined;
		if (
			!record ||
			record.activity.phase !== "submitting" ||
			record.activity.attemptId !== attempt?.attemptId
		) {
			return false;
		}
		this.agents.set(record.terminalId, {
			...record,
			activity: record.activity.previous,
		});
		return true;
	}

	applyStatus(paneId: string, status: AgentStatus): StatusResult {
		const record = this.byPane(paneId);
		if (!record) return { changed: false };
		if (status === "working") {
			const task = activityTask(record.activity);
			const attemptId =
				record.activity.phase === "settled"
					? undefined
					: record.activity.attemptId;
			const expectedUserAfter =
				record.activity.phase === "settled"
					? undefined
					: record.activity.expectedUserAfter;
			const next: AgentActivity = {
				phase: "working",
				...(attemptId ? { attemptId } : {}),
				...(expectedUserAfter !== undefined ? { expectedUserAfter } : {}),
				...(task ? { task } : {}),
			};
			const changed = !sameAgentActivity(record.activity, next);
			this.agents.set(record.terminalId, { ...record, activity: next });
			return { changed };
		}
		if (isSettledStatus(status) && record.activity.phase !== "settled") {
			const task = activityTask(record.activity);
			return {
				changed: false,
				completion: {
					record,
					requireNewReply: record.activity.phase === "submitting",
					status,
					...(task ? { task } : {}),
				},
			};
		}
		if (status === "unknown" && record.activity.phase !== "settled") {
			return { changed: false };
		}
		const next: AgentActivity = { phase: "settled", status };
		const changed = !sameAgentActivity(record.activity, next);
		this.agents.set(record.terminalId, { ...record, activity: next });
		return { changed };
	}

	reconcile(
		snapshot: SessionSnapshot,
		controllingPaneId?: string,
	): ReconcileResult {
		let changed = false;
		const completions: CompletionCandidate[] = [];
		const removed: MonitoredAgent[] = [];
		for (const record of this.list()) {
			const panel =
				snapshot.agents.find(
					(candidate) => candidate.terminal_id === record.terminalId,
				) ??
				snapshot.agents.find(
					(candidate) => candidate.pane_id === record.paneId,
				);
			if (!panel) {
				const paneStillExists = snapshot.panes.some(
					(candidate) =>
						candidate.terminal_id === record.terminalId ||
						candidate.pane_id === record.paneId,
				);
				if (!paneStillExists) {
					this.agents.delete(record.terminalId);
					removed.push(record);
					changed = true;
				}
				continue;
			}
			if (panel.agent !== "pi" || panel.pane_id === controllingPaneId) continue;

			let activity = record.activity;
			let completion: Omit<CompletionCandidate, "record"> | undefined;
			if (panel.agent_status === "working") {
				const task = activityTask(activity);
				const attemptId =
					activity.phase === "settled" ? undefined : activity.attemptId;
				const expectedUserAfter =
					activity.phase === "settled" ? undefined : activity.expectedUserAfter;
				activity = {
					phase: "working",
					...(attemptId ? { attemptId } : {}),
					...(expectedUserAfter !== undefined ? { expectedUserAfter } : {}),
					...(task ? { task } : {}),
				};
			} else if (
				isSettledStatus(panel.agent_status) &&
				activity.phase !== "settled"
			) {
				const task = activityTask(activity);
				completion = {
					requireNewReply: activity.phase === "submitting",
					status: panel.agent_status,
					...(task ? { task } : {}),
				};
			} else if (activity.phase === "settled") {
				activity = { phase: "settled", status: panel.agent_status };
			}

			const updated = recordForPanel(panel, activity, record.lastAssistantId);
			if (!sameMonitorRecord(record, updated)) changed = true;
			if (record.terminalId !== updated.terminalId) {
				this.agents.delete(record.terminalId);
			}
			this.agents.set(updated.terminalId, updated);
			if (completion) completions.push({ ...completion, record: updated });
		}
		return { changed, completions, removed };
	}

	movePane(
		previousPaneId: string,
		pane: { pane_id: string; tab_id?: string; workspace_id?: string },
	): boolean {
		const record = this.byPane(previousPaneId);
		if (!record) return false;
		this.agents.set(record.terminalId, {
			...record,
			paneId: pane.pane_id,
			...(pane.workspace_id ? { workspaceId: pane.workspace_id } : {}),
			...(pane.tab_id ? { tabId: pane.tab_id } : {}),
		});
		return true;
	}

	complete(
		terminalId: string,
		status: SettledAgentStatus,
		task: string | undefined,
		lastAssistantId?: string,
	): boolean {
		const record = this.byTerminal(terminalId);
		if (!record || activityTask(record.activity) !== task) return false;
		this.agents.set(terminalId, {
			...record,
			activity: { phase: "settled", status },
			...(lastAssistantId ? { lastAssistantId } : {}),
		});
		return true;
	}
}
