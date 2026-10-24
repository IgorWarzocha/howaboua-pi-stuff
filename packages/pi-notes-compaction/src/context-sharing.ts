import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ContextAgentBinding,
	ContextAgentIdentity,
} from "./agent-identity.js";
import type { NoteSnapshotData, SerializedCachedResponse } from "./bridge.js";

export type {
	ContextAgentBinding,
	ContextAgentIdentity,
} from "./agent-identity.js";
export type { ContextFamilyBindingOptions } from "./binding-startup.js";
export type { NoteSnapshotData } from "./bridge.js";

export interface SharedContextRequest {
	sessionId: string;
	agentName: string;
	namespace: "history" | "notes";
	params: Record<string, unknown>;
	/** Legacy encrypted arguments are rejected by local storage. */
	encryptedArguments?: boolean;
}

export type SharedContextResult = AgentToolResult<{
	codexHistoryNotes: Record<string, unknown>;
	externalNotesResponses?: SerializedCachedResponse[];
}>;

export type ContextRouter = ((
	ctx: ExtensionContext,
	request: SharedContextRequest,
	signal?: AbortSignal,
) => Promise<SharedContextResult | undefined>) & {
	requiresRemoteScope?(ctx: ExtensionContext): boolean;
};

/** Remote checkpoints retain an authenticated address, never decrypted note contents. */
export interface RemoteNoteReference {
	protocol: 1;
	storage: "remote";
	timestamp: number;
	identity: ContextAgentIdentity;
	baseUrl: string;
}
export type AttachmentNotesData = NoteSnapshotData | RemoteNoteReference;

export interface ContextSharingService {
	protocol: 1;
	canCreateChild(ctx: ExtensionContext): boolean;
	describe(ctx: ExtensionContext): ContextAgentIdentity | undefined;
	verify(ctx: ExtensionContext): Promise<void>;
	createChild(
		ctx: ExtensionContext,
		options: { name: string; routing?: unknown },
	): Promise<{
		binding: ContextAgentBinding;
		adopt(): Promise<void>;
	}>;
	bind(
		ctx: ExtensionContext,
		binding: unknown,
		options?: import("./binding-startup.js").ContextFamilyBindingOptions,
	): Promise<ContextAgentIdentity>;
	/** Inspect an idle standalone owner for alias attachment without rebinding its identity. */
	inspectAttachment?(
		ctx: ExtensionContext,
		standalone?: boolean,
	): Promise<ContextAgentIdentity> | ContextAgentIdentity;
	/** Keep the native family identity when retaining a live attachment. */
	retainAttachmentIdentity?(ctx: ExtensionContext): ContextAgentIdentity;
	exportAttachmentNotes?(
		ctx: ExtensionContext,
	): Promise<AttachmentNotesData> | AttachmentNotesData;
	validateAttachmentNotes?(
		snapshot: unknown,
		identity: ContextAgentIdentity,
	): void;
	verifyAttachmentAccess?(
		ctx: ExtensionContext,
		snapshot: unknown,
	): Promise<void>;
	executeRemoteAttachment?(
		ctx: ExtensionContext,
		reference: unknown,
		request: SharedContextRequest,
		signal?: AbortSignal,
	): Promise<SharedContextResult>;
	/** Parse only the verified owner's persisted active note branch. */
	parseAttachmentNotes?(
		entries: unknown,
		identity: ContextAgentIdentity,
	): NoteSnapshotData;
	readAttachmentNotes?(
		snapshot: unknown,
		params: Record<string, unknown>,
	): SharedContextResult;
	execute(
		ctx: ExtensionContext,
		request: SharedContextRequest,
		signal?: AbortSignal,
	): Promise<SharedContextResult>;
	registerRouter(router: ContextRouter): () => void;
}

export const CONTEXT_SHARING_AVAILABLE =
	"pi-notes-compaction:context-sharing:available";
export const CONTEXT_SHARING_REQUEST =
	"pi-notes-compaction:context-sharing:request";

/** Optional, load-order-independent integration. No provider or tool schema changes. */
export function connectNotesContextSharing(pi: ExtensionAPI): {
	readonly service: ContextSharingService | undefined;
	dispose(): void;
} {
	let service: ContextSharingService | undefined;
	const off = pi.events.on(CONTEXT_SHARING_AVAILABLE, (value) => {
		const candidate = value as Partial<ContextSharingService> | undefined;
		if (
			candidate?.protocol === 1 &&
			typeof candidate.canCreateChild === "function" &&
			typeof candidate.describe === "function" &&
			typeof candidate.verify === "function" &&
			typeof candidate.createChild === "function" &&
			typeof candidate.bind === "function" &&
			typeof candidate.execute === "function" &&
			typeof candidate.registerRouter === "function"
		)
			service = candidate as ContextSharingService;
	});
	pi.events.emit(CONTEXT_SHARING_REQUEST, { protocol: 1 });
	return {
		get service() {
			return service;
		},
		dispose() {
			off();
			service = undefined;
		},
	};
}
