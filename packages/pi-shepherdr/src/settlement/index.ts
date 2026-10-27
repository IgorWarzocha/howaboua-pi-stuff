import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	activityAttemptId,
	activityExpectedUser,
	activityTask,
} from "../activity.js";
import type { HerdrConnection } from "../herdr-client.js";
import type { MonitorState, WorkAttempt } from "../monitor-state.js";
import type { AssistantReader } from "../session-reader.js";
import type {
	ExtensionReply,
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
	SessionView,
	SettledAgentStatus,
} from "../types.js";
import { blockedSettlement, SettlementCollector } from "./collector.js";
import { SettlementDelivery } from "./delivery.js";

export type { ClaimedSettlement } from "./delivery.js";
export { SettlementCollector };

interface SettlementRetry {
	attemptId: string | undefined;
	count: number;
}

const SETTLEMENT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;
const SETTLEMENT_RETRY_WINDOW_SECONDS = Math.ceil(
	SETTLEMENT_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0) / 1_000,
);

function attemptKey(terminalId: string, attemptId: string | undefined): string {
	return JSON.stringify([terminalId, attemptId ?? null]);
}

export interface SettlementRequest {
	blockedMessage?: string;
	record: MonitoredAgent;
	requireNewReply?: boolean;
	status: SettledAgentStatus;
	task?: string;
}

export interface SettlementLifecycle {
	context: ExtensionContext;
	generation: number;
	isCurrent: () => boolean;
}

interface PendingBlockedSettlement {
	lifecycle: SettlementLifecycle;
	request: SettlementRequest;
	retry?: SettlementRetry;
}

export class SettlementReporter {
	private readonly collector: SettlementCollector;
	private readonly persist: () => void;
	private readonly reporting = new Map<string, SettledAgentStatus>();
	private readonly pendingBlocked = new Map<string, PendingBlockedSettlement>();
	private readonly delivery: SettlementDelivery;
	private readonly retries = new Map<string, NodeJS.Timeout>();
	private readonly state: MonitorState;

	constructor(
		pi: ExtensionAPI,
		client: HerdrConnection,
		state: MonitorState,
		persist: () => void,
		reader: AssistantReader | undefined,
		origin: { machine: string; label: () => string; operatorPrefix: string },
	) {
		this.delivery = new SettlementDelivery(pi, origin);
		this.collector = new SettlementCollector(client, reader);
		this.state = state;
		this.persist = persist;
	}

	latest(panel: PaneInfo): Promise<LatestAssistant | undefined> {
		return this.collector.latest(panel);
	}

	view(panel: PaneInfo): Promise<SessionView> {
		return this.collector.view(panel);
	}

	stop(): void {
		this.reporting.clear();
		this.pendingBlocked.clear();
		this.delivery.stop();
		for (const timer of this.retries.values()) clearTimeout(timer);
		this.retries.clear();
	}

	claim(
		attempt: WorkAttempt,
		signal: AbortSignal,
		replyingTo?: ExtensionReply,
	) {
		return this.delivery.claim(attempt, signal, replyingTo);
	}
	releaseClaim(attempt: WorkAttempt | undefined, error: unknown) {
		this.delivery.releaseClaim(attempt, error);
	}
	releaseAgentClaim(record: MonitoredAgent, error: unknown) {
		this.delivery.releaseAgentClaim(record, error);
	}
	async report(
		lifecycle: SettlementLifecycle,
		request: SettlementRequest,
		retry?: SettlementRetry,
	): Promise<void> {
		const task = request.task ?? activityTask(request.record.activity);
		const retryState = retry ?? {
			attemptId: activityAttemptId(request.record.activity),
			count: 0,
		};
		const key = `${lifecycle.generation}:${attemptKey(
			request.record.terminalId,
			retryState.attemptId,
		)}`;
		const activeStatus = this.reporting.get(key);
		if (activeStatus) {
			if (request.status === "blocked" && activeStatus !== "blocked") {
				this.pendingBlocked.set(key, {
					lifecycle,
					request,
					...(retry ? { retry } : {}),
				});
			}
			return;
		}
		this.reporting.set(key, request.status);
		try {
			const replyingTo = retryState.attemptId
				? this.delivery.replyingTo(retryState.attemptId)
				: undefined;
			const settlement = await this.collector.collect(
				request.record,
				request.status === "blocked" && !replyingTo ? "blocked" : undefined,
			);
			if (!settlement || !lifecycle.isCurrent()) return;
			if (this.pendingBlocked.has(key)) return;
			const current = this.state.byPane(settlement.agent.pane_id);
			if (!current || current.terminalId !== request.record.terminalId) return;
			if (
				activityTask(current.activity) !== task ||
				activityAttemptId(current.activity) !== retryState.attemptId
			) {
				if (request.status !== "blocked") return;
				this.clearRetry(request.record.terminalId, retryState.attemptId);
				this.delivery.deliverSettlement(
					lifecycle,
					request.record,
					settlement,
					retryState.attemptId,
					request.blockedMessage,
					undefined,
				);
				return;
			}
			const retryRequest = task ? { ...request, task } : request;
			const expectedUser = activityExpectedUser(current.activity);
			const blocked = settlement.status === "blocked";
			// Closing a message and publishing resumed status use separate transports.
			if (blocked && replyingTo) {
				if (
					settlement.extensionMessages?.some(
						(message) =>
							message.extension === replyingTo.extension &&
							message.id === replyingTo.id,
					)
				)
					return;
				if (
					!settlement.extensionMessages?.some((message) => message.blocking)
				) {
					if (!this.retry(lifecycle, retryRequest, retryState)) {
						this.failReconciliation(
							lifecycle,
							current,
							"the worker remained blocked after its extension reply",
						);
					}
					return;
				}
			}
			// A blocked status is authoritative even when Pi has not persisted the turn.
			// Pi persists expanded skills/templates, not the submitted command text.
			if (
				!blocked &&
				expectedUser &&
				(settlement.session.assistantAfterInput !== true ||
					!settlement.session.input ||
					settlement.session.input.id === expectedUser.after)
			) {
				if (!this.retry(lifecycle, retryRequest, retryState)) {
					this.failReconciliation(
						lifecycle,
						current,
						"the submitted input and reply were not persisted",
					);
				}
				return;
			}
			const newReply =
				!blocked && settlement.reply?.id !== current.lastAssistantId
					? settlement.reply
					: undefined;
			if (!blocked && request.requireNewReply && !newReply) {
				if (!this.retry(lifecycle, retryRequest, retryState)) {
					this.failReconciliation(
						lifecycle,
						current,
						"the new assistant reply was not persisted",
					);
				}
				return;
			}
			const blockedMessage =
				settlement.status === request.status
					? request.blockedMessage
					: undefined;
			const attemptId = activityAttemptId(current.activity);
			if (
				this.state.complete(
					current.terminalId,
					settlement.status,
					task,
					newReply?.id,
				)
			) {
				this.clearRetry(current.terminalId, retryState.attemptId);
				this.persist();
				this.delivery.deliverSettlement(
					lifecycle,
					current,
					settlement,
					attemptId,
					blockedMessage,
					newReply,
				);
			}
		} catch (error) {
			if (!lifecycle.isCurrent()) return;
			if (!this.state.byTerminal(request.record.terminalId)) return;
			if (request.status === "blocked") {
				const current = this.state.byTerminal(request.record.terminalId);
				if (current) {
					const currentOwnsAttempt =
						activityTask(current.activity) === task &&
						activityAttemptId(current.activity) === retryState.attemptId;
					this.clearRetry(request.record.terminalId, retryState.attemptId);
					if (
						currentOwnsAttempt &&
						this.state.complete(current.terminalId, "blocked", task)
					) {
						this.persist();
					}
					this.delivery.deliverSettlement(
						lifecycle,
						currentOwnsAttempt ? current : request.record,
						blockedSettlement(current),
						retryState.attemptId,
						request.blockedMessage,
						undefined,
					);
				}
				return;
			}
			if (this.pendingBlocked.has(key)) return;
			if (retryState.count === 0) {
				lifecycle.context.ui.notify(
					`Could not collect ${request.record.name ?? request.record.paneId}: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
			const retryRequest = task ? { ...request, task } : request;
			if (!this.retry(lifecycle, retryRequest, retryState)) {
				const current = this.state.byTerminal(request.record.terminalId);
				if (
					current &&
					activityTask(current.activity) === task &&
					activityAttemptId(current.activity) === retryState.attemptId
				) {
					this.failReconciliation(
						lifecycle,
						current,
						"the settlement snapshot remained unavailable",
					);
				}
			}
		} finally {
			this.reporting.delete(key);
			const pending = this.pendingBlocked.get(key);
			if (pending) {
				this.pendingBlocked.delete(key);
				void this.report(pending.lifecycle, pending.request, pending.retry);
			}
		}
	}

	private clearRetry(terminalId: string, attemptId: string | undefined): void {
		const key = attemptKey(terminalId, attemptId);
		const retry = this.retries.get(key);
		if (retry) clearTimeout(retry);
		this.retries.delete(key);
	}

	private retry(
		lifecycle: SettlementLifecycle,
		request: SettlementRequest,
		retry: SettlementRetry,
	): boolean {
		const delay = SETTLEMENT_RETRY_DELAYS_MS[retry.count];
		if (delay === undefined) return false;
		const current = this.state.byTerminal(request.record.terminalId);
		if (
			!lifecycle.isCurrent() ||
			!current ||
			activityTask(current.activity) !==
				(request.task ?? activityTask(request.record.activity)) ||
			activityAttemptId(current.activity) !== retry.attemptId
		) {
			return false;
		}
		const key = attemptKey(request.record.terminalId, retry.attemptId);
		if (this.retries.has(key)) return true;
		const timer = setTimeout(() => {
			this.retries.delete(key);
			if (!lifecycle.isCurrent()) return;
			const current = this.state.byTerminal(request.record.terminalId);
			if (!current) return;
			const currentOwnsAttempt =
				activityAttemptId(current.activity) === retry.attemptId &&
				activityTask(current.activity) ===
					(request.task ?? activityTask(request.record.activity));
			void this.report(
				lifecycle,
				{
					...request,
					record: currentOwnsAttempt
						? current
						: { ...current, activity: request.record.activity },
				},
				{ ...retry, count: retry.count + 1 },
			);
		}, delay);
		this.retries.set(key, timer);
		timer.unref();
		return true;
	}

	private failReconciliation(
		lifecycle: SettlementLifecycle,
		record: MonitoredAgent,
		reason: string,
	): void {
		const attemptId = activityAttemptId(record.activity);
		this.clearRetry(record.terminalId, attemptId);
		const message =
			(record.name ?? record.paneId) +
			" settled, but " +
			reason +
			" after " +
			SETTLEMENT_RETRY_WINDOW_SECONDS +
			" seconds";
		if (attemptId) this.delivery.releaseAttempt(attemptId, new Error(message));
		lifecycle.context.ui.notify(message, "warning");
	}
}
