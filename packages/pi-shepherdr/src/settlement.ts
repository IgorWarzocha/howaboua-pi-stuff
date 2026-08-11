import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { activityTask, isSettledStatus } from "./activity.js";
import { getAgent, getSnapshot, sessionPath } from "./herdr.js";
import type { HerdrClient } from "./herdr-client.js";
import { injectAgentEvent } from "./messages.js";
import type { MonitorState } from "./monitor-state.js";
import { SessionReader } from "./session-reader.js";
import type {
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
	SettledAgentStatus,
} from "./types.js";

interface SettlementLabels {
	tab?: string;
	workspace?: string;
}

export interface CollectedSettlement {
	agent: PaneInfo;
	labels: SettlementLabels;
	reply?: LatestAssistant;
	status: SettledAgentStatus;
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

export class SettlementCollector {
	private readonly client: HerdrClient;
	private readonly reader = new SessionReader();

	constructor(client: HerdrClient) {
		this.client = client;
	}

	latest(panel: PaneInfo): Promise<LatestAssistant | undefined> {
		return this.reader.latest(sessionPath(panel));
	}

	async collect(
		record: MonitoredAgent,
	): Promise<CollectedSettlement | undefined> {
		const agent = await getAgent(this.client, record.paneId);
		if (agent.terminal_id !== record.terminalId || agent.agent !== "pi") {
			return undefined;
		}
		const reply = await this.latest(agent);
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
			...(reply ? { reply } : {}),
			status: current.agent_status,
		};
	}
}

export class SettlementReporter {
	private readonly collector: SettlementCollector;
	private readonly persist: () => void;
	private readonly pi: ExtensionAPI;
	private readonly reporting = new Set<string>();
	private readonly retries = new Map<string, NodeJS.Timeout>();
	private readonly state: MonitorState;

	constructor(
		pi: ExtensionAPI,
		client: HerdrClient,
		state: MonitorState,
		persist: () => void,
	) {
		this.pi = pi;
		this.collector = new SettlementCollector(client);
		this.state = state;
		this.persist = persist;
	}

	latest(panel: PaneInfo): Promise<LatestAssistant | undefined> {
		return this.collector.latest(panel);
	}

	stop(): void {
		this.reporting.clear();
		for (const timer of this.retries.values()) clearTimeout(timer);
		this.retries.clear();
	}

	async report(
		lifecycle: SettlementLifecycle,
		request: SettlementRequest,
		retried = false,
	): Promise<void> {
		const task = request.task ?? activityTask(request.record.activity);
		const key = `${lifecycle.generation}:${request.record.terminalId}`;
		if (this.reporting.has(key)) return;
		this.reporting.add(key);
		try {
			const settlement = await this.collector.collect(request.record);
			if (!settlement || !lifecycle.isCurrent()) return;
			const current = this.state.byPane(settlement.agent.pane_id);
			if (!current || current.terminalId !== request.record.terminalId) return;
			const newReply =
				settlement.reply?.id !== current.lastAssistantId
					? settlement.reply
					: undefined;
			if (request.requireNewReply && !newReply) return;
			if (activityTask(current.activity) !== task) return;
			injectAgentEvent(this.pi, lifecycle.context, {
				agent: settlement.agent,
				...(settlement.status === request.status && request.blockedMessage
					? { blockedMessage: request.blockedMessage }
					: {}),
				labels: settlement.labels,
				record: current,
				...(newReply ? { reply: newReply } : {}),
				status: settlement.status,
			});
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
			}
		} catch (error) {
			lifecycle.context.ui.notify(
				`Could not collect ${request.record.name ?? request.record.paneId}: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
			if (!retried) {
				this.retry(lifecycle, task ? { ...request, task } : request);
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
	): void {
		if (
			!lifecycle.isCurrent() ||
			!this.state.byTerminal(request.record.terminalId) ||
			this.retries.has(request.record.terminalId)
		) {
			return;
		}
		const timer = setTimeout(() => {
			this.retries.delete(request.record.terminalId);
			if (!lifecycle.isCurrent()) return;
			const current = this.state.byTerminal(request.record.terminalId);
			if (!current) return;
			void this.report(lifecycle, { ...request, record: current }, true);
		}, 1_000);
		this.retries.set(request.record.terminalId, timer);
		timer.unref();
	}
}
