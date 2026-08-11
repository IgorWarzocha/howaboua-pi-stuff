import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgent, getSnapshot, sessionPath } from "./herdr.js";
import { HerdrClient } from "./herdr-client.js";
import { agentEventContent, injectAgentEvent } from "./messages.js";
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

interface MonitorStateEntry {
	agents: MonitoredAgent[];
}

function isMonitoredAgent(value: unknown): value is MonitoredAgent {
	if (typeof value !== "object" || value === null) return false;
	const agent = value as Partial<MonitoredAgent>;
	return (
		typeof agent.paneId === "string" &&
		typeof agent.terminalId === "string" &&
		typeof agent.workspaceId === "string" &&
		typeof agent.tabId === "string" &&
		typeof agent.lastStatus === "string"
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
	private unsubscribe: (() => void) | undefined;
	private reconnectTimer: NodeJS.Timeout | undefined;
	private subscriptionGeneration = 0;
	private readonly reporting = new Set<string>();

	constructor(pi: ExtensionAPI, client = new HerdrClient()) {
		this.pi = pi;
		this.client = client;
	}

	async activate(ctx: ExtensionContext): Promise<void> {
		this.deactivate();
		this.context = ctx;
		this.restore(ctx);
		renderAgentWidget(this.context, this.list());
		await this.reconcile();
		await this.refreshSubscription();
	}

	deactivate(): void {
		renderAgentWidget(this.context, []);
		this.context = undefined;
		this.subscriptionGeneration += 1;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	list(): MonitoredAgent[] {
		return [...this.agents.values()];
	}

	isMonitored(paneId: string): boolean {
		return this.agents.has(paneId);
	}

	async adopt(panel: PaneInfo): Promise<MonitoredAgent> {
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

	async release(paneId: string): Promise<boolean> {
		const removed = this.agents.delete(paneId);
		if (!removed) return false;
		this.persist();
		await this.refreshSubscription();
		return true;
	}

	setTask(paneId: string, task: string): void {
		const record = this.agents.get(paneId);
		if (!record) return;
		record.task = task;
		this.persist();
	}

	expectWork(paneId: string): void {
		const record = this.agents.get(paneId);
		if (!record) return;
		record.lastStatus = "working";
		this.persist();
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

	private async reconcile(): Promise<void> {
		if (this.agents.size === 0) return;
		const snapshot = await getSnapshot(this.client);
		let changed = false;
		const settled: Array<{ record: MonitoredAgent; status: AgentStatus }> = [];
		for (const [paneId, record] of [...this.agents]) {
			const panel =
				snapshot.agents.find(
					(candidate) => candidate.terminal_id === record.terminalId,
				) ?? snapshot.agents.find((candidate) => candidate.pane_id === paneId);
			if (
				!panel ||
				panel.agent !== "pi" ||
				panel.pane_id === process.env["HERDR_PANE_ID"]
			) {
				continue;
			}
			if (panel.pane_id !== paneId) this.agents.delete(paneId);
			const cwd = panel.foreground_cwd ?? panel.cwd;
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
				panel.agent_status !== record.lastStatus;
		}
		if (changed) this.persist();
		else renderAgentWidget(this.context, this.list());
		for (const completion of settled) {
			void this.reportSettled(completion.record, completion.status);
		}
	}

	private async refreshSubscription(): Promise<void> {
		const generation = ++this.subscriptionGeneration;
		const previousUnsubscribe = this.unsubscribe;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
		if (this.agents.size === 0 || !this.context) {
			previousUnsubscribe?.();
			this.unsubscribe = undefined;
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
		try {
			const unsubscribe = await this.client.subscribe(
				subscriptions,
				(event) => this.handleEvent(event),
				() => this.scheduleReconnect(generation, true),
			);
			if (generation !== this.subscriptionGeneration || !this.context) {
				unsubscribe();
				return;
			}
			previousUnsubscribe?.();
			this.unsubscribe = unsubscribe;
		} catch (error) {
			if (generation !== this.subscriptionGeneration || !this.context) return;
			this.context.ui.notify(
				`Herdr monitoring unavailable: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
			this.unsubscribe = previousUnsubscribe;
			this.scheduleReconnect(generation, false);
		}
	}

	private scheduleReconnect(generation: number, disconnected: boolean): void {
		if (generation !== this.subscriptionGeneration || !this.context) return;
		if (disconnected) this.unsubscribe = undefined;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.reconcile()
				.then(() => this.refreshSubscription())
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
				typeof event.data["title"] === "string"
					? event.data["title"]
					: undefined;
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
		if (this.reporting.has(record.terminalId)) return;
		this.reporting.add(record.terminalId);
		try {
			const [agent, snapshot] = await Promise.all([
				getAgent(this.client, record.paneId),
				getSnapshot(this.client),
			]);
			if (agent.terminal_id !== record.terminalId || agent.agent !== "pi")
				return;
			const reply = await this.reader.latest(sessionPath(agent));
			const newReply = reply?.id !== record.lastAssistantId ? reply : undefined;
			if (reply?.id) record.lastAssistantId = reply.id;
			this.persist();
			const context = this.context;
			if (!context) return;
			const labels = labelsFor(snapshot, agent);
			injectAgentEvent(
				this.pi,
				context,
				agentEventContent({
					agent,
					...(blockedMessage ? { blockedMessage } : {}),
					labels,
					record,
					...(newReply ? { reply: newReply } : {}),
					status,
				}),
				{
					paneId: agent.pane_id,
					terminalId: agent.terminal_id,
					workspaceId: agent.workspace_id,
					tabId: agent.tab_id,
					status,
					session: agent.agent_session,
				},
			);
		} catch (error) {
			this.context?.ui.notify(
				`Could not collect ${record.name ?? record.paneId}: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		} finally {
			this.reporting.delete(record.terminalId);
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
