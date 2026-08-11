export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentSessionInfo {
	agent: string;
	kind: "id" | "path";
	source: string;
	value: string;
}

export interface PaneInfo {
	agent?: string | null;
	agent_session?: AgentSessionInfo | null;
	agent_status: AgentStatus;
	cwd?: string | null;
	foreground_cwd?: string | null;
	interactive_ready?: boolean;
	launch_pending?: boolean;
	name?: string | null;
	pane_id: string;
	tab_id: string;
	terminal_id: string;
	workspace_id: string;
}

export interface TabInfo {
	label: string;
	tab_id: string;
	workspace_id: string;
}

export interface WorkspaceInfo {
	label: string;
	workspace_id: string;
}

export interface SessionSnapshot {
	agents: PaneInfo[];
	panes: PaneInfo[];
	tabs: TabInfo[];
	workspaces: WorkspaceInfo[];
}

export interface MonitoredAgent {
	cwd?: string;
	lastAssistantId?: string;
	lastStatus: AgentStatus;
	name?: string;
	paneId: string;
	tabId: string;
	task?: string;
	terminalId: string;
	workspaceId: string;
}

export interface LatestAssistant {
	id: string;
	stopReason?: string;
	text: string;
}

export interface HerdrEvent {
	data: Record<string, unknown>;
	event: string;
}
