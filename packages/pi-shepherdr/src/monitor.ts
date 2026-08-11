import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isSettledStatus } from "./activity.js";
import { getSnapshot } from "./herdr.js";
import { HerdrClient, isHerdrResponseError } from "./herdr-client.js";
import { parseMonitorEvent } from "./monitor-event.js";
import { MonitorEvents } from "./monitor-events.js";
import { MonitorState, type WorkAttempt } from "./monitor-state.js";
import { SettlementReporter, type SettlementRequest } from "./settlement.js";
import type { HerdrEvent, MonitoredAgent, PaneInfo } from "./types.js";
import { renderAgentWidget } from "./widget.js";

const MONITOR_STATE_TYPE = "herdr-agents-monitor-state";

interface MonitorStateEntry {
	agents: MonitoredAgent[];
}

export class AgentMonitor {
	readonly client: HerdrClient;
	private readonly pi: ExtensionAPI;
	private readonly state = new MonitorState();
	private readonly events: MonitorEvents;
	private readonly settlements: SettlementReporter;
	private context: ExtensionContext | undefined;
	private activationGeneration = 0;

	constructor(pi: ExtensionAPI, client = new HerdrClient()) {
		this.pi = pi;
		this.client = client;
		this.settlements = new SettlementReporter(pi, client, this.state, () =>
			this.persist(),
		);
		this.events = new MonitorEvents({
			client,
			onEvent: (event) => this.handleEvent(event),
			onReconnect: () => this.reconcileNow(),
			onWarning: (message) => this.context?.ui.notify(message, "warning"),
			targets: () => this.list().map((record) => record.paneId),
		});
	}

	async activate(ctx: ExtensionContext): Promise<void> {
		this.deactivate();
		const generation = this.activationGeneration;
		this.context = ctx;
		this.restore(ctx);
		renderAgentWidget(this.context, this.list());
		await this.reconcile(generation, ctx);
		if (generation !== this.activationGeneration || ctx !== this.context)
			return;
		await this.events.start();
	}

	deactivate(): void {
		this.activationGeneration += 1;
		renderAgentWidget(this.context, []);
		this.context = undefined;
		this.events.stop();
		this.settlements.stop();
	}

	list(): MonitoredAgent[] {
		return this.state.list();
	}

	isMonitored(paneId: string): boolean {
		return this.state.isMonitored(paneId);
	}

	async watch(panel: PaneInfo): Promise<MonitoredAgent> {
		if (panel.pane_id === process.env["HERDR_PANE_ID"]) {
			throw new Error("refusing to monitor the controlling Pi session");
		}
		const reply = await this.settlements.latest(panel);
		const { record, reportCurrent } = this.state.watch(panel, reply?.id);
		this.persist();
		await this.events.refresh();
		await this.reconcile(this.activationGeneration, this.context);
		if (reportCurrent && isSettledStatus(panel.agent_status)) {
			await this.report({ record, status: panel.agent_status });
		}
		return record;
	}

	async unwatch(paneId: string): Promise<boolean> {
		const record = this.state.removePane(paneId);
		if (!record) return false;
		this.persist();
		await this.events.refresh();
		return true;
	}

	beginWork(paneId: string, task: string): WorkAttempt | undefined {
		const attempt = this.state.beginWork(paneId, task);
		if (attempt) this.persist();
		return attempt;
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
		if (isHerdrResponseError(error)) {
			this.rejectWork(attempt);
			return;
		}
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

	private restore(ctx: ExtensionContext): void {
		let latest: MonitorStateEntry | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== MONITOR_STATE_TYPE)
				continue;
			const data = entry.data as Partial<MonitorStateEntry>;
			if (Array.isArray(data?.agents)) {
				latest = { agents: data.agents };
			}
		}
		const dropped = this.state.restore(
			latest?.agents ?? [],
			process.env["HERDR_PANE_ID"],
		);
		if (dropped > 0) {
			ctx.ui.notify(
				`Ignored ${dropped} invalid saved Shepherdr monitor ${dropped === 1 ? "record" : "records"}`,
				"warning",
			);
		}
	}

	private persist(): void {
		this.pi.appendEntry(MONITOR_STATE_TYPE, { agents: this.list() });
		renderAgentWidget(this.context, this.list());
	}

	private async reconcile(
		generation: number,
		context: ExtensionContext | undefined,
	): Promise<void> {
		if (
			!context ||
			generation !== this.activationGeneration ||
			context !== this.context ||
			this.list().length === 0
		) {
			return;
		}
		const snapshot = await getSnapshot(this.client);
		if (generation !== this.activationGeneration || context !== this.context)
			return;
		const { changed, completions } = this.state.reconcile(
			snapshot,
			process.env["HERDR_PANE_ID"],
		);
		if (changed) this.persist();
		else renderAgentWidget(this.context, this.list());
		for (const completion of completions) {
			void this.report(completion);
		}
	}

	private handleEvent(event: HerdrEvent): void {
		const parsed = parseMonitorEvent(event);
		if (!parsed) return;
		if (parsed.type === "closed") {
			const record = this.state.removePane(parsed.paneId);
			if (record) {
				this.persist();
				void this.events.refresh();
			}
			return;
		}
		if (parsed.type === "moved") {
			if (!this.state.movePane(parsed.previousPaneId, parsed.pane)) return;
			this.persist();
			void this.events.refresh();
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
