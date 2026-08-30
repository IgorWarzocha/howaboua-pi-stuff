export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type SettledAgentStatus = Exclude<AgentStatus, "working">;

export type StableAgentActivity =
	| { readonly phase: "settled"; readonly status: SettledAgentStatus }
	| {
			readonly attemptId?: string;
			readonly expectedUserAfter?: string | null;
			readonly phase: "working";
			readonly task?: string;
	  };

export type AgentActivity =
	| StableAgentActivity
	| {
			readonly attemptId: string;
			readonly expectedUserAfter?: string | null;
			readonly phase: "submitting";
			readonly previous: StableAgentActivity;
			readonly task: string;
	  };

interface AgentSessionInfo {
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

interface TabInfo {
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
	readonly activity: AgentActivity;
	readonly cwd?: string;
	readonly lastAssistantId?: string;
	readonly name?: string;
	readonly paneId: string;
	readonly tabId: string;
	readonly terminalId: string;
	readonly workspaceId: string;
}

type MachineConnectionStatus = "connected" | "connecting" | "unavailable";

export interface MachineStatus {
	local: boolean;
	name: string;
	reason?: string;
	status: MachineConnectionStatus;
}

export type ScopedMonitoredAgent = MonitoredAgent & { machine: string };

export interface LatestAssistant {
	id: string;
	stopReason?: string;
	text: string;
}

export interface LatestUser {
	id: string;
	text: string;
}

export interface PendingAsk {
	handoff: boolean;
	prompts: Array<{
		body?: string;
		choices: Array<{ description?: string; label: string }>;
		multiple: boolean;
		title: string;
	}>;
	toolCallId: string;
}

export interface SessionView {
	ask?: PendingAsk;
	assistant?: LatestAssistant;
	assistantAfterUser?: boolean;
	user?: LatestUser;
}

export interface HerdrEvent {
	data: Record<string, unknown>;
	event: string;
}
