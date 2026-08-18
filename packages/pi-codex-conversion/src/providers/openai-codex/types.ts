import type { AssistantMessage, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { CodexCompactionDiagnostic } from "../../adapter/compaction/diagnostics.ts";

export interface WebSocketLike {
	readyState?: number | undefined;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface WebSocketConstructorLike {
	new (url: string, options?: { headers?: Record<string, string> | undefined } | string | string[]): WebSocketLike;
}

export interface SessionWebSocketCacheEntry {
	socket: WebSocketLike;
	busy: boolean;
	continuation?: CachedWebSocketContinuationState | undefined;
}

export interface AcquiredWebSocket {
	socket: WebSocketLike;
	entry?: SessionWebSocketCacheEntry | undefined;
	reused: boolean;
	release: (options?: { keep?: boolean | undefined }) => void;
}

export interface CachedWebSocketContinuationState {
	lastRequestBody: ResponsesBody;
	lastResponseId: string;
	lastResponseItems: unknown[];
}

export type WebSocketContinuationDecision =
	| "disabled"
	| "no_session_cache_entry"
	| "no_continuation"
	| "body_mismatch"
	| "input_shorter_than_baseline"
	| "input_prefix_mismatch"
	| "missing_previous_response_id"
	| "delta";

export type CanonicalHistoryDecision =
	| "compaction"
	| "identity_mismatch"
	| "input_shorter_than_baseline"
	| "request_prefix_mismatch"
	| "response_prefix_mismatch"
	| "validated";

export type CodexDiagnosticsLane = "response" | "compaction" | "prewarm";
export type CodexDiagnosticsTransport = "websocket" | "sse";
export type CodexDiagnosticsFailureCategory =
	| "aborted"
	| "authentication"
	| "connection"
	| "connection_limit"
	| "message_too_big"
	| "overload"
	| "previous_response_missing"
	| "protocol"
	| "rate_limit"
	| "timeout"
	| "transport"
	| "unknown";
export interface CodexDiagnosticsFailure {
	category: CodexDiagnosticsFailureCategory;
	code?: string | undefined;
	status?: number | undefined;
}
export type CodexDiagnosticsEvent =
	| {
			type: "request";
			lane: CodexDiagnosticsLane;
			transport: CodexDiagnosticsTransport;
			attempt: number;
			fullInputItems: number;
			sentInputItems: number;
			model?: string | undefined;
			socketReused?: boolean | undefined;
			continuation?: WebSocketContinuationDecision | undefined;
			canonicalHistory?: CanonicalHistoryDecision | undefined;
			compaction?: CodexCompactionDiagnostic | undefined;
			previousResponseId?: boolean | undefined;
	  }
	| {
			type: "usage";
			lane: Exclude<CodexDiagnosticsLane, "prewarm">;
			transport: CodexDiagnosticsTransport;
			inputTokens: number;
			cachedInputTokens: number;
			cacheWriteInputTokens: number;
			outputTokens: number;
	  }
	| {
			type: "retry";
			lane: Exclude<CodexDiagnosticsLane, "prewarm">;
			transport: CodexDiagnosticsTransport;
			attempt: number;
			delayMs?: number | undefined;
			failure: CodexDiagnosticsFailure;
	  }
	| {
			type: "fallback";
			lane: Exclude<CodexDiagnosticsLane, "prewarm">;
			from: CodexDiagnosticsTransport;
			to: CodexDiagnosticsTransport;
			reason: "upgrade_required" | "message_too_big" | "unauthorized" | "retry_budget_exhausted";
	  }
	| {
			type: "failure";
			lane: CodexDiagnosticsLane;
			transport: CodexDiagnosticsTransport;
			failure: CodexDiagnosticsFailure;
	  }
	| {
			type: "prewarm-ready";
			transport: "websocket";
			socketReused: boolean;
	  };

export type CodexDiagnosticsSink = (event: CodexDiagnosticsEvent) => void;

export interface CachedWebSocketRequestBodyResult {
	body: ResponsesBody;
	decision: WebSocketContinuationDecision;
}

export type ServiceTier = ResponseCreateParamsStreaming["service_tier"];
export type ProviderEnv = Record<string, string>;
export type CodexProviderStreamOptions = SimpleStreamOptions & {
	serviceTier?: ServiceTier | undefined;
	textVerbosity?: string | undefined;
	reasoningSummary?: string | undefined;
	toolChoice?: "auto" | "none" | "required" | undefined;
};
export type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type OpenAICodexStreamOptions = CodexProviderStreamOptions & {
	reasoningEffort?: CodexReasoningEffort | undefined;
	responsesLite?: boolean | undefined;
	grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
	onOutputItemDone?: ((item: unknown) => void) | undefined;
	websocketConnectTimeoutMs?: number | undefined;
	env?: ProviderEnv | undefined;
	canonicalCompaction?: boolean | undefined;
	compactionDiagnostics?: CodexCompactionDiagnostic | undefined;
};

export interface ResponsesBody {
	model: string;
	store: boolean;
	stream: boolean;
	instructions?: string | undefined;
	previous_response_id?: string | undefined;
	input: unknown[];
	text: { verbosity: string };
	include: string[];
	prompt_cache_key?: string | undefined;
	tool_choice: "auto" | "none" | "required";
	parallel_tool_calls: boolean;
	temperature?: number | undefined;
	service_tier?: string | undefined;
	tools?: unknown[] | undefined;
	reasoning?: {
		effort?: string | undefined;
		summary?: string | undefined;
		context?: "all_turns" | undefined;
	} | undefined;
	client_metadata?: Record<string, string> | undefined;
	[key: string]: unknown;
}

export interface CodexPrewarmUsage {
	inputTokens: number;
	cachedInputTokens: number;
	cacheWriteInputTokens: number;
}

export interface CodexPrewarmResult {
	socketReused: boolean;
	usage?: CodexPrewarmUsage | undefined;
}

export interface ResponseEnvelope {
	id?: string | undefined;
	status?: string | undefined;
	usage?: {
		input_tokens?: number | undefined;
		output_tokens?: number | undefined;
		total_tokens?: number | undefined;
		input_tokens_details?: { cached_tokens?: number | undefined; cache_write_tokens?: number | undefined } | undefined;
		output_tokens_details?: { reasoning_tokens?: number | undefined } | undefined;
	} | undefined;
	service_tier?: string | undefined;
	error?: {
		code?: string | undefined;
		type?: string | undefined;
		message?: string | undefined;
		status?: number | string | undefined;
		status_code?: number | string | undefined;
		[key: string]: unknown;
	} | undefined;
	[key: string]: unknown;
}

export interface StreamEventShape {
	type?: string | undefined;
	headers?: Record<string, unknown> | undefined;
	response?: ResponseEnvelope | undefined;
	item?: {
		id?: string | undefined;
		type?: string | undefined;
		result?: string | null | undefined;
		output_format?: string | undefined;
		revised_prompt?: string | undefined;
		status?: string | undefined;
		[key: string]: unknown;
	} | undefined;
	code?: string | undefined;
	message?: string | undefined;
	[key: string]: unknown;
}

export function createInitialAssistantMessage(model: { provider: string; id: string }): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};
}
