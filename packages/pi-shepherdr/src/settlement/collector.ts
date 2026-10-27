import { isSettledStatus } from "../activity.js";
import { getAgent, getSnapshot, sessionPath } from "../herdr.js";
import type { HerdrConnection } from "../herdr-client.js";
import { type AssistantReader, SessionReader } from "../session-reader.js";
import type {
	ExtensionMessage,
	LatestAssistant,
	MonitoredAgent,
	PaneInfo,
	SessionView,
	SettledAgentStatus,
} from "../types.js";

interface SettlementLabels {
	tab?: string;
	workspace?: string;
}

export interface CollectedSettlement {
	agent: PaneInfo;
	extensionMessages?: ExtensionMessage[];
	labels: SettlementLabels;
	reply?: LatestAssistant;
	status: SettledAgentStatus;
}

export interface CollectedSettlementWithSession extends CollectedSettlement {
	session: SessionView;
}

export function blockedSettlement(
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
			...(view.extensionMessages
				? { extensionMessages: view.extensionMessages }
				: {}),
			session: view,
			status,
		};
	}
}
