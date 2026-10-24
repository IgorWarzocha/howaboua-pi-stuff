import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AgentToolResult,
	CustomMessageEntryDraft,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

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

export interface NoteSnapshotData {
	protocol: 1;
	timestamp: number;
	files: Array<{
		path: string;
		text: string;
		createdAt: number;
		updatedAt: number;
		operation: "local_append_overlay" | "local_replacement";
	}>;
}

/** JSON-safe raw provenance. Projection belongs to the requesting runtime. */
export interface SerializedCachedResponse
	extends Omit<CachedResponse, "bytes"> {
	bytesBase64: string;
}

export interface SharedNotesDetails {
	codexHistoryNotes: Record<string, unknown>;
	externalNotesResponses?: SerializedCachedResponse[];
	notesCompactionRouted?: true;
}

export interface NotesOwner {
	protocol: 1;
	owner: "pi-notes-compaction";
	identity(ctx: ExtensionContext): WindowIdentity | undefined;
	/** Current branch refreshes projection before later lifecycle hooks have run. */
	projectMessages(
		messages: readonly AgentMessage[],
		entries?: readonly SessionEntry[],
	): AgentMessage[];
	projectBranch(entries: readonly SessionEntry[]): SessionEntry[];
	canBind?(ctx: ExtensionContext, entries?: readonly SessionEntry[]): boolean;
	snapshotNotes?(
		entries: readonly SessionEntry[],
		agentName: string,
	): NoteSnapshotData;
	executeShared?(
		query: LookupQuery,
		callId: string,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<AgentToolResult<SharedNotesDetails>>;
}

export interface NotesBridge {
	protocol: 1;
	/** Preserve the owner's chronological entry while enabling developer-role delivery. */
	prepareReminder?(entry: CustomMessageEntryDraft): CustomMessageEntryDraft;
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
		relay?: boolean,
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

export interface OwnerRequest {
	protocol: 1;
	ctx?: ExtensionContext;
	projection?(
		owner: Pick<NotesOwner, "projectMessages" | "projectBranch">,
	): void;
	reply(owner: NotesOwner): void;
}

export function queryKey(query: LookupQuery): string {
	return JSON.stringify([
		query.namespace,
		Object.entries(query.params).sort(([a], [b]) => a.localeCompare(b)),
	]);
}
