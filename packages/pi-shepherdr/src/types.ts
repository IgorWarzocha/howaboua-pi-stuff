export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface PeerMessage {
	text: string;
	sender: string;
	context?: string;
	closeIfIdle?: true;
}

export interface PeerDelivery {
	result?: string;
	command: boolean;
	commands?: PeerCommand[];
}

export interface PeerCommand {
	name: string;
	description: string;
}

export interface MachineIdentity {
	host: string;
	session: string;
}

export interface FocusRequest {
	source: MachineIdentity & {
		backend?: "core";
		pane?: string;
		terminal: string;
		sessionFile: string;
	};
	handoff?: string;
	voice?: boolean;
	voiceAudioTransport?: "webrtc" | "pcm24";
}

export interface PeerChannel {
	send(message: unknown): void;
	onMessage(listener: (message: unknown) => void): () => void;
	onClose(listener: (error: Error) => void): () => void;
	close(): void;
}

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
	backend?: "core";
	agent?: string | null;
	agent_session?: AgentSessionInfo | null;
	agent_status: AgentStatus;
	cwd?: string | null;
	foreground_cwd?: string | null;
	interactive_ready?: boolean;
	label?: string | null;
	launch_pending?: boolean;
	name?: string | null;
	pane_id: string;
	title?: string | null;
	tab_id?: string;
	terminal_id: string;
	workspace_id?: string;
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
	readonly instructions?: string;
	readonly scope: "task" | "persistent";
	readonly activity: AgentActivity;
	readonly cwd?: string;
	readonly lastAssistantId?: string;
	readonly notifiedExtensionMessages?: string[];
	readonly name?: string;
	readonly paneId: string;
	readonly tabId?: string;
	readonly terminalId: string;
	readonly workspaceId?: string;
}

type MachineConnectionStatus = "connected" | "connecting" | "unavailable";

export interface MonitoringIssue {
	state: "degraded" | "unavailable";
	message: string;
}

export interface MachineStatus {
	local: boolean;
	id: string;
	label?: string;
	target?: string;
	session?: string;
	monitoringIssue?: MonitoringIssue;
	contextRelayError?: string;
	attempting?: boolean;
	reason?: string;
	status: MachineConnectionStatus;
}

export type ScopedMonitoredAgent = MonitoredAgent & { machine: string };

export interface LatestAssistant {
	id: string;
	stopReason?: string;
	text: string;
}

export interface LatestInput {
	id: string;
	text: string;
}

export interface ExtensionMessage {
	extension: string;
	id: string;
	message: string;
	reply?: string;
	blocking: boolean;
}

export interface ExtensionReply {
	extension: string;
	id: string;
	message: string;
}

export interface SessionView {
	extensionMessages?: ExtensionMessage[];
	assistant?: LatestAssistant;
	assistantPending?: boolean;
	assistantAfterInput?: boolean;
	input?: LatestInput;
}

export interface HerdrEvent {
	data: Record<string, unknown>;
	event: string;
}
