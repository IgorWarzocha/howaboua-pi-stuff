import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	activityAttemptId,
	activityExpectedUser,
	activityTask,
	isSettledStatus,
} from "./activity.js";
import { getAgent, getSnapshot, sessionPath } from "./herdr.js";
import type { HerdrConnection } from "./herdr-client.js";
import { injectAgentEvent } from "./messages.js";
import type { MonitorState, WorkAttempt } from "./monitor-state.js";
import { type AssistantReader, SessionReader } from "./session-reader.js";
import type {
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
	PendingAsk,
	SessionView,
	SettledAgentStatus,
} from "./types.js";

interface SettlementLabels {
	tab?: string;
	workspace?: string;
}

interface CollectedSettlement {
	agent: PaneInfo;
	ask?: PendingAsk;
	labels: SettlementLabels;
	reply?: LatestAssistant;
	status: SettledAgentStatus;
}

interface CollectedSettlementWithSession extends CollectedSettlement {
	session: SessionView;
}

export interface ClaimedSettlement extends CollectedSettlement {
	blockedMessage?: string;
	record: MonitoredAgent;
}

interface SettlementClaim {
	cleanup(): void;
	reject(error: Error): void;
	resolve(settlement: ClaimedSettlement): void;
}

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

function blockedSettlement(
	record: MonitoredAgent,
): CollectedSettlementWithSession {
	return {
		agent: {
			agent: "pi",
			agent_status: "blocked",
			...(record.cwd ? { cwd: record.cwd } : {}),
			...(record.name ? { name: record.name } : {}),
			pane_id: record.paneId,
			tab_id: record.tabId,
			terminal_id: record.terminalId,
			workspace_id: record.workspaceId,
		},
		labels: {},
		session: {},
		status: "blocked",
	};
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

export class SettlementCollector {
	private readonly client: HerdrConnection;
	private readonly reader: AssistantReader;

	constructor(
		client: HerdrConnection,
		reader: AssistantReader = new SessionReader(),
	) {
		this.client = client;
		this.reader = reader;
	}

	async latest(panel: PaneInfo): Promise<LatestAssistant | undefined> {
		try {
			return await this.reader.latest(sessionPath(panel));
		} catch (error) {
			if (panel.agent_status !== "blocked") throw error;
			return undefined;
		}
	}

	view(panel: PaneInfo): Promise<SessionView> {
		return this.reader.view(sessionPath(panel));
	}

	async collect(
		record: MonitoredAgent,
		reportedStatus?: "blocked",
	): Promise<CollectedSettlementWithSession | undefined> {
		const [current, snapshot] = await Promise.all([
			getAgent(this.client, record.paneId),
			getSnapshot(this.client),
		]);
		if (current.terminal_id !== record.terminalId || current.agent !== "pi") {
			return reportedStatus === "blocked"
				? blockedSettlement(record)
				: undefined;
		}
		const status =
			reportedStatus ??
			(isSettledStatus(current.agent_status)
				? current.agent_status
				: undefined);
		if (!status) return undefined;
		let view: SessionView;
		try {
			view = await this.reader.view(sessionPath(current));
		} catch (error) {
			if (status !== "blocked") throw error;
			view = {};
		}
		const workspace = snapshot.workspaces.find(
			(candidate) => candidate.workspace_id === current.workspace_id,
		)?.label;
		const tab = snapshot.tabs.find(
			(candidate) => candidate.tab_id === current.tab_id,
		)?.label;
		return {
			agent: current,
			labels: {
				...(workspace ? { workspace } : {}),
				...(tab ? { tab } : {}),
			},
			...(view.assistant ? { reply: view.assistant } : {}),
			...(status === "blocked" && view.ask ? { ask: view.ask } : {}),
			session: view,
			status,
		};
	}
}

export class SettlementReporter {
	private readonly collector: SettlementCollector;
	private readonly persist: () => void;
	private readonly pi: ExtensionAPI;
	private readonly machine: string;
	private readonly operatorPrefix: string;
	private readonly reporting = new Map<string, SettledAgentStatus>();
	private readonly pendingBlocked = new Map<string, PendingBlockedSettlement>();
	private readonly claims = new Map<string, SettlementClaim>();
	private readonly retries = new Map<string, NodeJS.Timeout>();
	private readonly state: MonitorState;

	constructor(
		pi: ExtensionAPI,
		client: HerdrConnection,
		state: MonitorState,
		persist: () => void,
		reader?: AssistantReader,
		machine = "local",
		operatorPrefix = "herdr",
	) {
		this.pi = pi;
		this.collector = new SettlementCollector(client, reader);
		this.state = state;
		this.persist = persist;
		this.machine = machine;
		this.operatorPrefix = operatorPrefix;
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
		for (const claim of this.claims.values()) {
			claim.cleanup();
			claim.reject(new Error("Shepherdr monitor stopped"));
		}
		this.claims.clear();
		for (const timer of this.retries.values()) clearTimeout(timer);
		this.retries.clear();
	}

	claim(attempt: WorkAttempt, signal: AbortSignal): Promise<ClaimedSettlement> {
		signal.throwIfAborted();
		if (this.claims.has(attempt.attemptId)) {
			throw new Error(`work attempt ${attempt.attemptId} is already claimed`);
		}
		return new Promise<ClaimedSettlement>((resolve, reject) => {
			const abort = () => {
				const claim = this.claims.get(attempt.attemptId);
				if (!claim) return;
				this.claims.delete(attempt.attemptId);
				claim.cleanup();
				reject(
					signal.reason instanceof Error
						? signal.reason
						: new Error("Shepherdr wait aborted"),
				);
			};
			const claim: SettlementClaim = {
				cleanup: () => signal.removeEventListener("abort", abort),
				reject,
				resolve,
			};
			this.claims.set(attempt.attemptId, claim);
			signal.addEventListener("abort", abort, { once: true });
		});
	}

	releaseClaim(attempt: WorkAttempt | undefined, error: unknown): void {
		if (!attempt) return;
		this.releaseAttempt(attempt.attemptId, error);
	}

	releaseAgentClaim(record: MonitoredAgent, error: unknown): void {
		const attemptId = activityAttemptId(record.activity);
		if (attemptId) this.releaseAttempt(attemptId, error);
	}

	private releaseAttempt(attemptId: string, error: unknown): void {
		const claim = this.claims.get(attemptId);
		if (!claim) return;
		this.claims.delete(attemptId);
		claim.cleanup();
		claim.reject(error instanceof Error ? error : new Error(String(error)));
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
			const settlement = await this.collector.collect(
				request.record,
				request.status === "blocked" ? "blocked" : undefined,
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
				this.deliverSettlement(
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
			// A blocked status is authoritative even when Pi has not persisted the turn.
			// Pi persists expanded skills/templates, not the submitted command text.
			if (
				!blocked &&
				expectedUser &&
				(settlement.session.assistantAfterUser !== true ||
					!settlement.session.user ||
					settlement.session.user.id === expectedUser.after)
			) {
				if (!this.retry(lifecycle, retryRequest, retryState)) {
					this.failReconciliation(
						lifecycle,
						current,
						"the submitted user message and reply were not persisted",
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
				this.deliverSettlement(
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
					this.deliverSettlement(
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

	private deliverSettlement(
		lifecycle: SettlementLifecycle,
		record: MonitoredAgent,
		settlement: CollectedSettlementWithSession,
		attemptId: string | undefined,
		blockedMessage: string | undefined,
		reply: LatestAssistant | undefined,
	): void {
		const claim = attemptId ? this.claims.get(attemptId) : undefined;
		if (claim && attemptId) {
			this.claims.delete(attemptId);
			claim.cleanup();
			const {
				reply: _latestReply,
				session: _session,
				...claimedSettlement
			} = settlement;
			claim.resolve({
				...claimedSettlement,
				record,
				...(blockedMessage ? { blockedMessage } : {}),
				...(reply ? { reply } : {}),
			});
			return;
		}
		injectAgentEvent(this.pi, lifecycle.context, {
			agent: settlement.agent,
			agentToolName: "agents",
			...(settlement.ask ? { ask: settlement.ask } : {}),
			machine: this.machine,
			operatorPrefix: this.operatorPrefix,
			...(blockedMessage ? { blockedMessage } : {}),
			labels: settlement.labels,
			record,
			...(reply ? { reply } : {}),
			status: settlement.status,
		});
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
		if (attemptId) this.releaseAttempt(attemptId, new Error(message));
		lifecycle.context.ui.notify(message, "warning");
	}
}
