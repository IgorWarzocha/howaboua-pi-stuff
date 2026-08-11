import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgent, getSnapshot, sessionPath } from "./herdr.js";
import { HerdrClient } from "./herdr-client.js";
import { injectAgentEvent } from "./messages.js";
import { SessionReader } from "./session-reader.js";
import type {
	AgentStatus,
	HerdrEvent,
	MonitoredAgent,
	PaneInfo,
	SessionSnapshot,
} from "./types.js";
import { renderAgentWidget } from "./widget.js";

const MONITOR_STATE_TYPE = "herdr-agents-monitor-state";
const SETTLED_STATUSES = new Set<AgentStatus>(["idle", "done", "blocked"]);
const AGENT_STATUSES: ReadonlySet<string> = new Set([
	"idle",
	"working",
	"blocked",
	"done",
	"unknown",
]);

interface MonitorStateEntry {
	agents: MonitoredAgent[];
}

interface ActiveSubscription {
	generation: number;
	unsubscribe: () => void;
}

function isAgentStatus(value: unknown): value is AgentStatus {
	return typeof value === "string" && AGENT_STATUSES.has(value);
}

function blockedReason(data: Record<string, unknown>): string | undefined {
	const stateLabels = data["state_labels"];
	if (
		typeof stateLabels === "object" &&
		stateLabels !== null &&
		"blocked" in stateLabels &&
		typeof stateLabels.blocked === "string"
	) {
		return stateLabels.blocked;
	}
	return typeof data["title"] === "string" ? data["title"] : undefined;
}

function isMonitoredAgent(value: unknown): value is MonitoredAgent {
	if (typeof value !== "object" || value === null) return false;
	const agent = value as Partial<MonitoredAgent>;
	return (
		typeof agent.paneId === "string" &&
		typeof agent.terminalId === "string" &&
		typeof agent.workspaceId === "string" &&
		typeof agent.tabId === "string" &&
		isAgentStatus(agent.lastStatus)
	);
}

function panelRecord(
	panel: PaneInfo,
	lastAssistantId?: string,
): MonitoredAgent {
	const cwd = panel.foreground_cwd ?? panel.cwd;
	return {
		paneId: panel.pane_id,
		terminalId: panel.terminal_id,
		workspaceId: panel.workspace_id,
		tabId: panel.tab_id,
		lastStatus: panel.agent_status,
		...(panel.name ? { name: panel.name } : {}),
		...(cwd ? { cwd } : {}),
		...(lastAssistantId ? { lastAssistantId } : {}),
	};
}

export class AgentMonitor {
	readonly client: HerdrClient;
	private readonly pi: ExtensionAPI;
	private readonly reader = new SessionReader();
	private readonly agents = new Map<string, MonitoredAgent>();
	private context: ExtensionContext | undefined;
	private subscription: ActiveSubscription | undefined;
	private readonly liveSubscriptionGenerations = new Set<number>();
	private reconnectTimer: NodeJS.Timeout | undefined;
	private subscriptionGeneration = 0;
	private activationGeneration = 0;
	private subscriptionWarningShown = false;
	private readonly reporting = new Set<string>();

	constructor(pi: ExtensionAPI, client = new HerdrClient()) {
		this.pi = pi;
		this.client = client;
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
		await this.refreshSubscription();
	}

	deactivate(): void {
		this.activationGeneration += 1;
		renderAgentWidget(this.context, []);
		this.context = undefined;
		this.subscriptionGeneration += 1;
		this.liveSubscriptionGenerations.clear();
		this.subscription?.unsubscribe();
		this.subscription = undefined;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	list(): MonitoredAgent[] {
		return [...this.agents.values()];
	}

	isMonitored(paneId: string): boolean {
		return this.agents.has(paneId);
	}

	async watch(panel: PaneInfo): Promise<MonitoredAgent> {
		if (panel.pane_id === process.env["HERDR_PANE_ID"]) {
			throw new Error("refusing to monitor the controlling Pi session");
		}
		const reply = await this.reader.latest(sessionPath(panel));
		const existing = this.agents.get(panel.pane_id);
		const record = {
			...panelRecord(panel, reply?.id),
			...(existing?.task ? { task: existing.task } : {}),
		};
		this.agents.set(panel.pane_id, record);
		this.persist();
		await this.refreshSubscription();
		return record;
	}

	async unwatch(paneId: string): Promise<boolean> {
		const removed = this.agents.delete(paneId);
		if (!removed) return false;
		this.persist();
		await this.refreshSubscription();
		return true;
	}

	beginWork(paneId: string, task: string): void {
		const record = this.agents.get(paneId);
		if (!record) return;
		record.task = task;
		record.lastStatus = "working";
		this.persist();
	}

	async reconcileNow(): Promise<void> {
		await this.reconcile(this.activationGeneration, this.context);
	}

	private restore(ctx: ExtensionContext): void {
		this.agents.clear();
		let latest: MonitorStateEntry | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== MONITOR_STATE_TYPE)
				continue;
			const data = entry.data as Partial<MonitorStateEntry>;
			if (Array.isArray(data?.agents)) {
				latest = { agents: data.agents.filter(isMonitoredAgent) };
			}
		}
		for (const record of latest?.agents ?? []) {
			if (record.paneId !== process.env["HERDR_PANE_ID"]) {
				this.agents.set(record.paneId, { ...record });
			}
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
			this.agents.size === 0
		) {
			return;
		}
		const snapshot = await getSnapshot(this.client);
		if (generation !== this.activationGeneration || context !== this.context)
			return;
		let changed = false;
		const settled: Array<{ record: MonitoredAgent; status: AgentStatus }> = [];
		for (const [paneId, record] of [...this.agents]) {
			const panel =
				snapshot.agents.find(
					(candidate) => candidate.terminal_id === record.terminalId,
				) ?? snapshot.agents.find((candidate) => candidate.pane_id === paneId);
			if (!panel) {
				const paneStillExists = snapshot.panes.some(
					(candidate) =>
						candidate.terminal_id === record.terminalId ||
						candidate.pane_id === paneId,
				);
				if (!paneStillExists) {
					this.agents.delete(paneId);
					changed = true;
				}
				continue;
			}
			if (
				panel.agent !== "pi" ||
				panel.pane_id === process.env["HERDR_PANE_ID"]
			) {
				continue;
			}
			if (panel.pane_id !== paneId) this.agents.delete(paneId);
			const cwd = panel.foreground_cwd ?? panel.cwd;
			const name = panel.name ?? undefined;
			const updated = {
				...record,
				paneId: panel.pane_id,
				terminalId: panel.terminal_id,
				workspaceId: panel.workspace_id,
				tabId: panel.tab_id,
				lastStatus: panel.agent_status,
				...(panel.name ? { name: panel.name } : {}),
				...(cwd ? { cwd } : {}),
			};
			if (!name) delete updated.name;
			if (!cwd) delete updated.cwd;
			this.agents.set(panel.pane_id, updated);
			if (
				record.lastStatus === "working" &&
				SETTLED_STATUSES.has(panel.agent_status)
			) {
				settled.push({ record: updated, status: panel.agent_status });
			}
			changed ||=
				panel.pane_id !== paneId ||
				panel.terminal_id !== record.terminalId ||
				panel.agent_status !== record.lastStatus ||
				panel.workspace_id !== record.workspaceId ||
				panel.tab_id !== record.tabId ||
				name !== record.name ||
				cwd !== record.cwd;
		}
		if (changed) this.persist();
		else renderAgentWidget(this.context, this.list());
		for (const completion of settled) {
			void this.reportSettled(completion.record, completion.status);
		}
	}

	private async refreshSubscription(): Promise<void> {
		const generation = ++this.subscriptionGeneration;
		const previousSubscription = this.subscription;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
		if (this.agents.size === 0 || !this.context) {
			if (previousSubscription) {
				this.liveSubscriptionGenerations.delete(
					previousSubscription.generation,
				);
				previousSubscription.unsubscribe();
			}
			this.subscription = undefined;
			return;
		}
		const subscriptions = [
			...this.list().map((agent) => ({
				type: "pane.agent_status_changed",
				pane_id: agent.paneId,
			})),
			{ type: "pane.moved" },
			{ type: "pane.closed" },
		];
		this.liveSubscriptionGenerations.add(generation);
		try {
			const unsubscribe = await this.client.subscribe(
				subscriptions,
				(event) => {
					if (
						this.liveSubscriptionGenerations.has(generation) &&
						this.context
					) {
						this.handleEvent(event);
					}
				},
				() => {
					this.liveSubscriptionGenerations.delete(generation);
					this.scheduleReconnect(generation, true);
				},
			);
			if (
				generation !== this.subscriptionGeneration ||
				!this.context ||
				!this.liveSubscriptionGenerations.has(generation)
			) {
				this.liveSubscriptionGenerations.delete(generation);
				unsubscribe();
				return;
			}
			if (previousSubscription) {
				this.liveSubscriptionGenerations.delete(
					previousSubscription.generation,
				);
				previousSubscription.unsubscribe();
			}
			this.subscription = { generation, unsubscribe };
			this.subscriptionWarningShown = false;
		} catch (error) {
			this.liveSubscriptionGenerations.delete(generation);
			if (generation !== this.subscriptionGeneration || !this.context) return;
			if (!this.subscriptionWarningShown) {
				this.subscriptionWarningShown = true;
				this.context.ui.notify(
					`Herdr monitoring unavailable: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
			this.scheduleReconnect(generation, false);
		}
	}

	private scheduleReconnect(generation: number, disconnected: boolean): void {
		if (generation !== this.subscriptionGeneration || !this.context) return;
		if (disconnected && this.subscription?.generation === generation) {
			this.subscription = undefined;
		}
		const activationGeneration = this.activationGeneration;
		const context = this.context;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.reconcile(activationGeneration, context)
				.then(() => {
					if (
						activationGeneration === this.activationGeneration &&
						context === this.context
					) {
						return this.refreshSubscription();
					}
				})
				.catch((error) => {
					this.context?.ui.notify(
						`Herdr monitoring reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
				});
		}, 1_000);
		this.reconnectTimer.unref();
	}

	private handleEvent(event: HerdrEvent): void {
		if (event.event === "pane.moved") {
			this.handleMoved(event.data);
			return;
		}
		if (event.event === "pane.closed") {
			const paneId = event.data["pane_id"];
			if (typeof paneId === "string" && this.agents.delete(paneId)) {
				this.persist();
				void this.refreshSubscription();
			}
			return;
		}
		if (event.event !== "pane.agent_status_changed") return;
		const paneId = event.data["pane_id"];
		const status = event.data["agent_status"];
		if (typeof paneId !== "string" || typeof status !== "string") return;
		if (!SETTLED_STATUSES.has(status as AgentStatus) && status !== "working")
			return;
		const record = this.agents.get(paneId);
		if (!record) return;
		const previous = record.lastStatus;
		record.lastStatus = status as AgentStatus;
		this.persist();
		if (SETTLED_STATUSES.has(status as AgentStatus) && previous === "working") {
			const blockedMessage =
				status === "blocked" ? blockedReason(event.data) : undefined;
			void this.reportSettled(record, status as AgentStatus, blockedMessage);
		}
	}

	private handleMoved(data: Record<string, unknown>): void {
		const previousPaneId = data["previous_pane_id"];
		const pane = data["pane"];
		if (
			typeof previousPaneId !== "string" ||
			typeof pane !== "object" ||
			pane === null ||
			!("pane_id" in pane) ||
			typeof pane.pane_id !== "string"
		) {
			return;
		}
		const record = this.agents.get(previousPaneId);
		if (!record) return;
		this.agents.delete(previousPaneId);
		record.paneId = pane.pane_id;
		if ("workspace_id" in pane && typeof pane.workspace_id === "string") {
			record.workspaceId = pane.workspace_id;
		}
		if ("tab_id" in pane && typeof pane.tab_id === "string") {
			record.tabId = pane.tab_id;
		}
		this.agents.set(record.paneId, record);
		this.persist();
		void this.refreshSubscription();
	}

	private async reportSettled(
		record: MonitoredAgent,
		status: AgentStatus,
		blockedMessage?: string,
	): Promise<void> {
		const generation = this.activationGeneration;
		const context = this.context;
		if (!context) return;
		const reportKey = `${generation}:${record.terminalId}`;
		if (this.reporting.has(reportKey)) return;
		this.reporting.add(reportKey);
		try {
			const agent = await getAgent(this.client, record.paneId);
			if (agent.terminal_id !== record.terminalId || agent.agent !== "pi")
				return;
			const reply = await this.reader.latest(sessionPath(agent));
			const [currentAgent, snapshot] = await Promise.all([
				getAgent(this.client, record.paneId),
				getSnapshot(this.client),
			]);
			if (
				currentAgent.terminal_id !== record.terminalId ||
				currentAgent.agent !== "pi" ||
				!SETTLED_STATUSES.has(currentAgent.agent_status)
			) {
				return;
			}
			const currentStatus = currentAgent.agent_status;
			if (generation !== this.activationGeneration || context !== this.context)
				return;
			const newReply = reply?.id !== record.lastAssistantId ? reply : undefined;
			if (reply?.id) record.lastAssistantId = reply.id;
			this.persist();
			const labels = labelsFor(snapshot, currentAgent);
			injectAgentEvent(this.pi, context, {
				agent: currentAgent,
				...(currentStatus === status && blockedMessage
					? { blockedMessage }
					: {}),
				labels,
				record,
				...(newReply ? { reply: newReply } : {}),
				status: currentStatus,
			});
		} catch (error) {
			this.context?.ui.notify(
				`Could not collect ${record.name ?? record.paneId}: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		} finally {
			this.reporting.delete(reportKey);
		}
	}
}

function labelsFor(
	snapshot: SessionSnapshot,
	agent: PaneInfo,
): { tab?: string; workspace?: string } {
	const workspace = snapshot.workspaces.find(
		(candidate) => candidate.workspace_id === agent.workspace_id,
	)?.label;
	const tab = snapshot.tabs.find(
		(candidate) => candidate.tab_id === agent.tab_id,
	)?.label;
	return {
		...(workspace ? { workspace } : {}),
		...(tab ? { tab } : {}),
	};
}
