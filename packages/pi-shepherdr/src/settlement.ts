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

	latest(panel: PaneInfo): Promise<LatestAssistant | undefined> {
		return this.reader.latest(sessionPath(panel));
	}

	view(panel: PaneInfo): Promise<SessionView> {
		return this.reader.view(sessionPath(panel));
	}

	async collect(
		record: MonitoredAgent,
	): Promise<CollectedSettlementWithSession | undefined> {
		const [current, snapshot] = await Promise.all([
			getAgent(this.client, record.paneId),
			getSnapshot(this.client),
		]);
		if (
			current.terminal_id !== record.terminalId ||
			current.agent !== "pi" ||
			!isSettledStatus(current.agent_status)
		) {
			return undefined;
		}
		const view = await this.reader.view(sessionPath(current));
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
			...(current.agent_status === "blocked" && view.ask
				? { ask: view.ask }
				: {}),
			session: view,
			status: current.agent_status,
		};
	}
}

export class SettlementReporter {
	private readonly collector: SettlementCollector;
	private readonly persist: () => void;
	private readonly pi: ExtensionAPI;
	private readonly machine: string;
	private readonly agentToolName: string;
	private readonly operatorPrefix: string;
	private readonly reporting = new Set<string>();
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
		agentToolName = "herdr_agents",
	) {
		this.pi = pi;
		this.collector = new SettlementCollector(client, reader);
		this.state = state;
		this.persist = persist;
		this.machine = machine;
		this.agentToolName = agentToolName;
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
		const key = `${lifecycle.generation}:${request.record.terminalId}`;
		if (this.reporting.has(key)) return;
		this.reporting.add(key);
		try {
			const settlement = await this.collector.collect(request.record);
			if (!settlement || !lifecycle.isCurrent()) return;
			const current = this.state.byPane(settlement.agent.pane_id);
			if (!current || current.terminalId !== request.record.terminalId) return;
			if (activityTask(current.activity) !== task) return;
			if (activityAttemptId(current.activity) !== retryState.attemptId) return;
			const retryRequest = task ? { ...request, task } : request;
			const expectedUser = activityExpectedUser(current.activity);
			if (
				expectedUser &&
				(settlement.session.assistantAfterUser !== true ||
					!settlement.session.user ||
					settlement.session.user.id === expectedUser.after ||
					settlement.session.user.text !== expectedUser.text)
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
				settlement.reply?.id !== current.lastAssistantId
					? settlement.reply
					: undefined;
			if (request.requireNewReply && !newReply && !settlement.ask) {
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
			const claim = attemptId ? this.claims.get(attemptId) : undefined;
			if (
				this.state.complete(
					current.terminalId,
					settlement.status,
					task,
					settlement.reply?.id,
				)
			) {
				this.clearRetry(current.terminalId);
				this.persist();
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
						record: current,
						...(blockedMessage ? { blockedMessage } : {}),
						...(newReply ? { reply: newReply } : {}),
					});
				} else {
					injectAgentEvent(this.pi, lifecycle.context, {
						agent: settlement.agent,
						agentToolName: this.agentToolName,
						...(settlement.ask ? { ask: settlement.ask } : {}),
						machine: this.machine,
						operatorPrefix: this.operatorPrefix,
						...(blockedMessage ? { blockedMessage } : {}),
						labels: settlement.labels,
						record: current,
						...(newReply ? { reply: newReply } : {}),
						status: settlement.status,
					});
				}
			}
		} catch (error) {
			if (!lifecycle.isCurrent()) return;
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
		}
	}

	private clearRetry(terminalId: string): void {
		const retry = this.retries.get(terminalId);
		if (retry) clearTimeout(retry);
		this.retries.delete(terminalId);
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
		if (this.retries.has(request.record.terminalId)) return true;
		const timer = setTimeout(() => {
			this.retries.delete(request.record.terminalId);
			if (!lifecycle.isCurrent()) return;
			const current = this.state.byTerminal(request.record.terminalId);
			if (!current) return;
			void this.report(
				lifecycle,
				{ ...request, record: current },
				{ ...retry, count: retry.count + 1 },
			);
		}, delay);
		this.retries.set(request.record.terminalId, timer);
		timer.unref();
		return true;
	}

	private failReconciliation(
		lifecycle: SettlementLifecycle,
		record: MonitoredAgent,
		reason: string,
	): void {
		this.clearRetry(record.terminalId);
		const message =
			(record.name ?? record.paneId) +
			" settled, but " +
			reason +
			" after " +
			SETTLEMENT_RETRY_WINDOW_SECONDS +
			" seconds";
		const attemptId = activityAttemptId(record.activity);
		if (attemptId) this.releaseAttempt(attemptId, new Error(message));
		lifecycle.context.ui.notify(message, "warning");
	}
}
