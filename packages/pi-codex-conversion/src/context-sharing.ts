import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextAgentIdentity } from "./context-management/agent-identity.js";

export type { ContextAgentIdentity } from "./context-management/agent-identity.js";

export interface SharedContextRequest {
	sessionId: string;
	agentName: string;
	namespace: "history" | "notes";
	params: Record<string, unknown>;
}

export type SharedContextResult = AgentToolResult<{ codexHistoryNotes: Record<string, unknown> }>;

export type ContextRouter = (ctx: ExtensionContext, request: SharedContextRequest, signal?: AbortSignal) => Promise<SharedContextResult>;

export interface ContextSharingService {
	protocol: 1;
	describe(ctx: ExtensionContext): ContextAgentIdentity | undefined;
	verify(ctx: ExtensionContext): Promise<void>;
	createChild(ctx: ExtensionContext, options: { name: string; cwd: string; routing?: unknown }): Promise<{
		identity: ContextAgentIdentity;
		jsonl: string;
	}>;
	execute(ctx: ExtensionContext, request: SharedContextRequest, signal?: AbortSignal): Promise<SharedContextResult>;
	registerRouter(router: ContextRouter): () => void;
}

export const CONTEXT_SHARING_AVAILABLE = "pi-codex:context-sharing:available";
export const CONTEXT_SHARING_REQUEST = "pi-codex:context-sharing:request";

/** Optional, load-order-independent integration. No provider or tool schema changes. */
export function connectCodexContextSharing(pi: ExtensionAPI): { readonly service: ContextSharingService | undefined; dispose(): void } {
	let service: ContextSharingService | undefined;
	const off = pi.events.on(CONTEXT_SHARING_AVAILABLE, (value) => {
		const candidate = value as Partial<ContextSharingService> | undefined;
		if (candidate?.protocol === 1 && typeof candidate.describe === "function" && typeof candidate.verify === "function" &&
			typeof candidate.createChild === "function" && typeof candidate.execute === "function" &&
			typeof candidate.registerRouter === "function") service = candidate as ContextSharingService;
	});
	pi.events.emit(CONTEXT_SHARING_REQUEST, { protocol: 1 });
	return { get service() { return service; }, dispose() { off(); service = undefined; } };
}
