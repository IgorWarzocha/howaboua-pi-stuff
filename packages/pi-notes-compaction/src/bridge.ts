import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const BRIDGE_CHANNEL = "pi-notes-compaction:bridge:v1";
export const OWNER_CHANNEL = "pi-notes-compaction:owner:v1";
export const TOOL_NAMES = [
	"notes",
	"history",
	"new_context",
	"get_context_remaining",
] as const;

export interface LookupQuery {
	namespace: "notes" | "history";
	params: Record<string, unknown>;
}

/** Raw backend response, not a reconstructed ciphertext or an old delivery receipt. */
export interface CachedResponse {
	query: LookupQuery;
	bytes: Uint8Array;
	source: string;
	encoding: string;
	fetchedAt: number;
	coverage: "complete" | "partial" | "unknown";
}

export interface WindowIdentity {
	firstWindowId: string;
	currentWindowId: string;
	previousWindowId?: string;
	windowNumber: number;
}

export interface NotesOwner {
	protocol: 1;
	owner: "pi-notes-compaction";
	identity(ctx: ExtensionContext): WindowIdentity | undefined;
	projectMessages(messages: readonly AgentMessage[]): AgentMessage[];
	projectBranch(entries: readonly SessionEntry[]): SessionEntry[];
}

export interface NotesBridge {
	protocol: 1;
	/** Synchronous atomic handoff. No legacy registrations or lifecycle owners remain active. */
	claim(owner: NotesOwner):
		| {
				claimed: true;
				registerTools(
					tools: readonly ToolDefinition[],
					ctx: ExtensionContext,
				): void;
		  }
		| { claimed: false; reason: string };
	/** Configures PCC nested registrations, visibility and opaque-result capture. Never nests new_context. */
	configureTools?(
		tools: readonly ToolDefinition[],
		ctx: ExtensionContext,
		contracts: Readonly<Record<"notes" | "history", string>>,
	): void;
	beforeWindow?(ctx: ExtensionContext, signal?: AbortSignal): Promise<void>;
	lookup?(
		query: LookupQuery,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<readonly CachedResponse[]>;
	canProject?(ctx: ExtensionContext): boolean;
	/** Fresh current-call delivery, including original exec ancestry when nested. */
	projectResult?(
		result: AgentToolResult<unknown>,
		responses: readonly CachedResponse[],
		callId: string,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown>>;
	agentName?(ctx: ExtensionContext): string;
	/** Optional family routing. undefined means this agent owns the requested path. */
	route?(
		query: LookupQuery,
		callId: string,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown> | undefined>;
}

export interface BridgeRequest {
	protocol: 1;
	reply(bridge: NotesBridge): void;
}
export interface OwnerRequest {
	protocol: 1;
	reply(owner: NotesOwner): void;
}

export function discoverBridge(pi: ExtensionAPI): NotesBridge | undefined {
	let found: NotesBridge | undefined;
	pi.events.emit(BRIDGE_CHANNEL, {
		protocol: 1,
		reply(bridge: NotesBridge) {
			if (bridge?.protocol !== 1 || typeof bridge.claim !== "function")
				throw new Error("Unsupported notes bridge");
			if (found && found !== bridge)
				throw new Error("Multiple notes bridges responded");
			found = bridge;
		},
	} satisfies BridgeRequest);
	return found;
}

export function queryKey(query: LookupQuery): string {
	return JSON.stringify([
		query.namespace,
		Object.entries(query.params).sort(([a], [b]) => a.localeCompare(b)),
	]);
}
