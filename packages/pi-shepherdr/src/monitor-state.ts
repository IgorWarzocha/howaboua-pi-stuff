import { randomUUID } from "node:crypto";
import { activityForPanel, activityTask, isSettledStatus } from "./activity.js";
import {
	parseMonitoredAgent,
	recordForPanel,
	sameMonitorRecord,
} from "./monitor-record.js";
import type {
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

export class MonitorState {
	private readonly agents = new Map<string, MonitoredAgent>();
	private readonly pendingSubmissions = new Set<string>();

	restore(values: unknown[], controllingPaneId?: string): number {
		this.agents.clear();
		this.pendingSubmissions.clear();
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

	markExtensionMessage(terminalId: string, id: string): boolean {
		const record = this.byTerminal(terminalId);
		if (!record || record.notifiedExtensionMessages?.includes(id)) return false;
		this.agents.set(terminalId, {
			...record,
			notifiedExtensionMessages: [
				...(record.notifiedExtensionMessages ?? []),
				id,
			],
		});
		return true;
	}
	retainExtensionNotifications(terminalId: string, live: string[]): boolean {
		const record = this.byTerminal(terminalId);
		if (!record?.notifiedExtensionMessages) return false;
		const retained = record.notifiedExtensionMessages.filter((id) =>
			live.includes(id),
		);
		if (retained.length === record.notifiedExtensionMessages.length)
			return false;
		this.agents.set(terminalId, {
			...record,
			notifiedExtensionMessages: retained,
		});
		return true;
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
			? ({ attemptId: randomUUID(), phase: "working" } as const)
			: (existing?.activity ?? activityForPanel(panel));
		const record = {
			...(existing?.instructions
				? { instructions: existing.instructions }
				: {}),
			...(existing?.latestInstruction
				? { latestInstruction: existing.latestInstruction }
				: {}),
			...recordForPanel(
				panel,
				activity,
				reportSettled ? "persistent" : (existing?.scope ?? "task"),
				reportCurrent
					? undefined
					: (existing?.lastAssistantId ?? lastAssistantId),
				existing?.notifiedExtensionMessages,
			),
		};
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
			attemptId:
				record.activity.phase === "working"
					? (record.activity.attemptId ?? randomUUID())
					: randomUUID(),
			terminalId: record.terminalId,
		};
		this.pendingSubmissions.add(attempt.attemptId);
		this.agents.set(record.terminalId, {
			...record,
			activity: {
				attemptId: attempt.attemptId,
				phase: "submitting",
				previous: record.activity,
				task: activityTask(record.activity) ?? task,
				...(expectedUserAfter !== undefined ? { expectedUserAfter } : {}),
			},
		});
		return attempt;
	}

	noteMessage(paneId: string, message: string): boolean {
		const record = this.byPane(paneId);
		if (!record) return false;
		const instructions =
			record.instructions ?? activityTask(record.activity) ?? message;
		const latestInstruction = message !== instructions ? message : undefined;
		const { latestInstruction: previousInstruction, ...prior } = record;
		if (
			record.instructions === instructions &&
			previousInstruction === latestInstruction
		)
			return false;
		this.agents.set(record.terminalId, {
			...prior,
			instructions,
			...(latestInstruction ? { latestInstruction } : {}),
		});
		return true;
	}

	endSubmission(attempt: WorkAttempt | undefined): void {
		if (attempt) this.pendingSubmissions.delete(attempt.attemptId);
	}

	acceptWork(attempt: WorkAttempt | undefined): boolean {
		this.endSubmission(attempt);
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
		this.endSubmission(attempt);
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
			if (
				activity.phase === "submitting" &&
				this.pendingSubmissions.has(activity.attemptId)
			) {
				// Keep the rollback state until submission is acknowledged.
			} else if (panel.agent_status === "working") {
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
				panel.agent_status === "blocked" &&
				activity.phase === "settled" &&
				activity.status !== "blocked"
			) {
				activity = {
					attemptId: randomUUID(),
					phase: "working",
				};
				completion = {
					requireNewReply: false,
					status: panel.agent_status,
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

			const updated = {
				...(record.instructions ? { instructions: record.instructions } : {}),
				...(record.latestInstruction
					? { latestInstruction: record.latestInstruction }
					: {}),
				...recordForPanel(
					panel,
					activity,
					record.scope,
					record.lastAssistantId,
					record.notifiedExtensionMessages,
				),
			};
			if (!sameMonitorRecord(record, updated)) changed = true;
			if (record.terminalId !== updated.terminalId) {
				this.agents.delete(record.terminalId);
			}
			this.agents.set(updated.terminalId, updated);
			if (completion) completions.push({ ...completion, record: updated });
		}
		return { changed, completions, removed };
	}

	complete(
		terminalId: string,
		status: SettledAgentStatus,
		task: string | undefined,
		lastAssistantId?: string,
	): boolean {
		const record = this.byTerminal(terminalId);
		if (
			!record ||
			activityTask(record.activity) !== task ||
			(record.activity.phase === "submitting" &&
				this.pendingSubmissions.has(record.activity.attemptId))
		)
			return false;
		this.agents.set(terminalId, {
			...record,
			scope: "persistent",
			activity: { phase: "settled", status },
			...(lastAssistantId ? { lastAssistantId } : {}),
		});
		return true;
	}
}
