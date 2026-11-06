import { isSettledStatus } from "../activity.js";
import { getSnapshot, sessionPath } from "../core/agents.js";
import type { CoreConnection } from "../core/backend.js";
import { object } from "../core/protocol.js";
import { terminalPane } from "../core/terminal.js";
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
			...(record.tabId ? { tab_id: record.tabId } : {}),
			terminal_id: record.terminalId,
			...(record.workspaceId ? { workspace_id: record.workspaceId } : {}),
		},
		labels: {},
		session: {},
		status: "blocked",
	};
}

export class SettlementCollector {
	private readonly client: CoreConnection;
	private readonly reader: AssistantReader;

	constructor(
		client: CoreConnection,
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
	): Promise<CollectedSettlementWithSession | "closed" | undefined> {
		let terminal: unknown;
		try {
			terminal = await this.client.core.request("terminal.get", {
				terminal: record.terminalId,
			});
		} catch (error) {
			// Only this exact lookup proves closure; snapshot/read/transport failures do not.
			if (
				error instanceof Error &&
				"kind" in error &&
				error.kind === "not_found"
			)
				return "closed";
			throw error;
		}
		const current = terminalPane(terminal);
		if (
			current.terminal_id === record.terminalId &&
			object(terminal)["state"] === "finished"
		)
			return "closed";
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
		const snapshot = await getSnapshot(this.client);
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
