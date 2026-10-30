import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isSettledStatus } from "./activity.js";
import { getSnapshot } from "./herdr.js";
import { type HerdrConnection, isDispatchRejected } from "./herdr-client.js";
import { injectAgentEvent } from "./messages/events.js";
import { parseMonitorEvent } from "./monitor-event.js";
import { MonitorEvents } from "./monitor-events.js";
import { MonitorExtensionMessages } from "./monitor-extension-messages.js";
import { MonitorState, type WorkAttempt } from "./monitor-state.js";
import { type AssistantReader, SessionReader } from "./session-reader.js";
import {
	type ClaimedSettlement,
	SettlementReporter,
	type SettlementRequest,
} from "./settlement/index.js";
import type {
	ExtensionReply,
	HerdrEvent,
	MonitoredAgent,
	MonitoringIssue,
	PaneInfo,
	SessionView,
} from "./types.js";

interface AgentMonitorOptions {
	client: HerdrConnection;
	machine: string;
	machineLabel: () => string;
	onChange: () => void;
	onRefresh: () => void;
	operatorPrefix: string;
	onWarning: (issue: MonitoringIssue) => void;
	onRecovered: () => void;
	reader?: AssistantReader;
	reconnect: boolean;
	selfPaneId?: string;
}

export class AgentMonitor {
	readonly client: HerdrConnection;
	readonly machine: string;
	private readonly onChange: () => void;
	private readonly onRefresh: () => void;
	private readonly selfPaneId: string | undefined;
	private readonly state = new MonitorState();
	private readonly events: MonitorEvents;
	private readonly settlements: SettlementReporter;
	private readonly extensionMessages: MonitorExtensionMessages;
	private context: ExtensionContext | undefined;
	private activationGeneration = 0;
	private coreReconcile: Promise<void> | undefined;
	private coreDirty = false;

	constructor(pi: ExtensionAPI, options: AgentMonitorOptions) {
		this.client = options.client;
		this.machine = options.machine;
		this.onChange = options.onChange;
		this.onRefresh = options.onRefresh;
		this.selfPaneId = options.selfPaneId;
		const reader = options.reader ?? new SessionReader();
		this.extensionMessages = new MonitorExtensionMessages({
			client: this.client,
			machine: this.machine,
			machineLabel: options.machineLabel,
			reader,
			state: this.state,
			notify: (ctx, record, agent, message) => {
				injectAgentEvent(pi, ctx, {
					agent,
					extensionMessages: [message],
					record,
					status: "extension-message",
					labels: {},
					agentToolName: "agents",
					machine: this.machine,
					machineLabel: options.machineLabel(),
					operatorPrefix: options.operatorPrefix,
				});
			},
			persist: () => this.persist(),
		});
		this.settlements = new SettlementReporter(
			pi,
			this.client,
			this.state,
			() => {
				this.persist();
				this.refreshAfterEvent();
			},
			reader,
			{
				machine: this.machine,
				label: options.machineLabel,
				operatorPrefix: options.operatorPrefix,
			},
		);
		this.events = new MonitorEvents({
			client: this.client,
			reconnect: options.reconnect,
			onEvent: (event) => this.handleEvent(event),
			reconcile: () => this.reconcileNow(),
			onWarning: options.onWarning,
			onRecovered: options.onRecovered,
			targets: () => this.list().map((record) => record.paneId),
		});
	}

	async activate(
		ctx: ExtensionContext,
		restored: unknown[] = [],
	): Promise<void> {
		this.deactivate();
		const generation = this.activationGeneration;
		this.context = ctx;
		this.extensionMessages.start(ctx);
		const dropped = this.state.restore(restored, this.selfPaneId);
		if (dropped > 0) {
			ctx.ui.notify(
				`Ignored ${dropped} invalid saved Shepherdr monitor ${dropped === 1 ? "record" : "records"} for ${this.machine}`,
				"warning",
			);
		}
		this.onRefresh();
		await this.reconcile(generation, ctx, dropped > 0);
		if (generation !== this.activationGeneration || ctx !== this.context)
			return;
		await this.events.start();
	}

	deactivate(): void {
		this.activationGeneration += 1;
		this.coreDirty = false;
		this.coreReconcile = undefined;
		this.context = undefined;
		this.events.stop();
		this.extensionMessages.stop();
		this.settlements.stop();
	}

	list(): MonitoredAgent[] {
		return this.state.list();
	}

	async watch(panel: PaneInfo): Promise<MonitoredAgent> {
		return this.watchPanel(panel, true);
	}

	async track(panel: PaneInfo): Promise<MonitoredAgent> {
		return this.watchPanel(panel, false);
	}

	private async watchPanel(
		panel: PaneInfo,
		reportSettled: boolean,
	): Promise<MonitoredAgent> {
		if (panel.pane_id === this.selfPaneId) {
			throw new Error("refusing to monitor the controlling Pi session");
		}
		const reply = await this.settlements.latest(panel);
		const { record, reportCurrent } = this.state.watch(
			panel,
			reply?.id,
			reportSettled,
		);
		this.persist();
		await this.events.refresh();
		if (reportCurrent && isSettledStatus(panel.agent_status)) {
			await this.report({ record, status: panel.agent_status });
		}
		return record;
	}

	async unwatch(paneId: string): Promise<boolean> {
		const record = this.state.removePane(paneId);
		if (!record) return false;
		this.settlements.releaseAgentClaim(
			record,
			new Error(`${paneId} was unwatched before its work settled`),
		);
		this.persist();
		await this.extensionMessages.refresh();
		await this.events.refresh();
		return true;
	}

	beginWork(
		paneId: string,
		task: string,
		expectedUserAfter?: string | null,
	): WorkAttempt | undefined {
		const attempt = this.state.beginWork(paneId, task, expectedUserAfter);
		if (attempt) this.persist();
		return attempt;
	}

	claimWork(
		attempt: WorkAttempt,
		signal: AbortSignal,
		replyingTo?: ExtensionReply,
	): Promise<ClaimedSettlement> | undefined {
		return this.settlements.claim(attempt, signal, replyingTo);
	}

	noteMessage(paneId: string, message: string): void {
		if (this.state.noteMessage(paneId, message)) this.persist();
	}

	releaseWorkClaim(attempt: WorkAttempt | undefined, error: unknown): void {
		this.settlements.releaseClaim(attempt, error);
	}

	view(panel: PaneInfo): Promise<SessionView> {
		return this.settlements.view(panel);
	}

	acceptWork(attempt: WorkAttempt | undefined): void {
		if (this.state.acceptWork(attempt)) this.persist();
	}

	rejectWork(attempt: WorkAttempt | undefined): void {
		if (this.state.rejectWork(attempt)) this.persist();
	}

	async handleWorkFailure(
		attempt: WorkAttempt | undefined,
		error: unknown,
	): Promise<void> {
		if (isDispatchRejected(error)) {
			this.rejectWork(attempt);
			return;
		}
		// An unknown acknowledgement must not leave status processing suspended.
		this.state.endSubmission(attempt);
		try {
			await this.reconcileNow();
		} catch (reconcileError) {
			this.context?.ui.notify(
				`Herdr prompt outcome remains uncertain: ${reconcileError instanceof Error ? reconcileError.message : String(reconcileError)}`,
				"warning",
			);
		}
	}

	async reconcileNow(): Promise<void> {
		await this.reconcile(this.activationGeneration, this.context);
	}

	retryMonitoring(): Promise<void> {
		return this.events.retry();
	}

	private persist(): void {
		this.onChange();
	}

	private async reconcile(
		generation: number,
		context: ExtensionContext | undefined,
		persistRestoration = false,
	): Promise<void> {
		if (
			!context ||
			generation !== this.activationGeneration ||
			context !== this.context
		) {
			return;
		}
		if (this.list().length === 0) {
			await this.extensionMessages.refresh([]);
			if (persistRestoration) this.persist();
			else this.onRefresh();
			return;
		}
		const snapshot = await getSnapshot(this.client);
		if (generation !== this.activationGeneration || context !== this.context)
			return;
		const { changed, completions, removed } = this.state.reconcile(
			snapshot,
			this.selfPaneId,
		);
		for (const record of removed) {
			this.settlements.releaseAgentClaim(
				record,
				new Error(`${record.paneId} closed before its work settled`),
			);
		}
		if (changed || persistRestoration) this.persist();
		else this.onRefresh();
		await this.extensionMessages.refresh(snapshot.agents);
		for (const completion of completions) {
			void this.report(completion);
		}
	}

	private handleEvent(event: HerdrEvent): void {
		if (event.event === "core.reconcile") {
			const generation = this.activationGeneration;
			const context = this.context;
			this.coreDirty = true;
			if (this.coreReconcile) return;
			this.coreReconcile = Promise.resolve()
				.then(async () => {
					while (this.coreDirty && generation === this.activationGeneration) {
						this.coreDirty = false;
						await this.reconcile(generation, context);
					}
				})
				.catch((error) => {
					if (generation === this.activationGeneration) {
						this.context?.ui.notify(
							`Core monitoring reconciliation failed: ${String(error)}`,
							"warning",
						);
						void this.events.retry().catch(() => undefined);
					}
				})
				.finally(() => {
					if (generation === this.activationGeneration)
						this.coreReconcile = undefined;
				});
			return;
		}
		const parsed = parseMonitorEvent(event);
		if (!parsed) return;
		if (parsed.type === "closed") {
			const record = this.state.removePane(parsed.paneId);
			if (record) {
				this.settlements.releaseAgentClaim(
					record,
					new Error(`${parsed.paneId} closed before its work settled`),
				);
				this.persist();
				this.refreshAfterEvent();
			}
			return;
		}
		if (parsed.type === "moved") {
			if (!this.state.movePane(parsed.previousPaneId, parsed.pane)) return;
			this.persist();
			this.refreshAfterEvent();
			return;
		}
		const result = this.state.applyStatus(parsed.paneId, parsed.status);
		if (result.changed) this.persist();
		if (result.completion) {
			void this.report({
				...result.completion,
				...(parsed.blockedMessage
					? { blockedMessage: parsed.blockedMessage }
					: {}),
			});
		}
	}

	private refreshAfterEvent(): void {
		void this.extensionMessages.refresh();
		// MonitorEvents reports failures through onWarning before rejecting awaited updates.
		void this.events.refresh().catch(() => undefined);
	}

	private report(request: SettlementRequest): Promise<void> {
		const generation = this.activationGeneration;
		const context = this.context;
		if (!context) return Promise.resolve();
		return this.settlements.report(
			{
				context,
				generation,
				isCurrent: () =>
					generation === this.activationGeneration && context === this.context,
			},
			request,
		);
	}
}
