import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

export interface SavedGeneratedImage {
	absolutePath: string;
	relativePath: string;
	latestAbsolutePath: string;
	latestRelativePath: string;
	responseId: string | undefined;
	callId: string;
	outputFormat: string;
	revisedPrompt?: string | undefined;
}

export interface ImageDisplayMessageDetails {
	savedImages: SavedGeneratedImage[];
}

export interface PendingImageDisplay {
	savedImage: SavedGeneratedImage;
	imageData: { data: string; mimeType: string };
}

export interface QueuedImageActivity extends PendingImageDisplay {
	kind: "image";
}

export interface SurfacedWebSearch {
	callId: string;
	status?: string | undefined;
	query?: string | undefined;
	queries: string[];
	sources: Array<{ title?: string | undefined; url: string }>;
}

export interface QueuedWebSearchActivity {
	kind: "web-search";
	search: SurfacedWebSearch;
}

export type PendingActivity = QueuedImageActivity | QueuedWebSearchActivity;
export type SendActivityMessage = ExtensionAPI["sendMessage"];

export interface CachedImagePreview {
	data: string;
	mimeType: string;
}

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
	idleTimer?: ReturnType<typeof setTimeout> | undefined;
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

export interface CachedWebSocketRequestBodyResult {
	body: ResponsesBody;
	decision: WebSocketContinuationDecision;
}

export type ServiceTier = ResponseCreateParamsStreaming["service_tier"];
export type CodexProviderStreamOptions = SimpleStreamOptions & { serviceTier?: ServiceTier | undefined; textVerbosity?: string | undefined; reasoningSummary?: string | undefined };
export type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type OpenAICodexStreamOptions = CodexProviderStreamOptions & {
	reasoningEffort?: CodexReasoningEffort | undefined;
	websocketConnectTimeoutMs?: number | undefined;
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
	tool_choice: "auto";
	parallel_tool_calls: boolean;
	temperature?: number | undefined;
	service_tier?: string | undefined;
	tools?: unknown[] | undefined;
	reasoning?: {
		effort: string;
		summary: string;
	} | undefined;
	[key: string]: unknown;
}

export interface ResponseEnvelope {
	id?: string | undefined;
	status?: string | undefined;
	usage?: {
		input_tokens?: number | undefined;
		output_tokens?: number | undefined;
		total_tokens?: number | undefined;
		input_tokens_details?: { cached_tokens?: number | undefined } | undefined;
	} | undefined;
	service_tier?: string | undefined;
	error?: { message?: string | undefined } | undefined;
	[key: string]: unknown;
}

export interface StreamEventShape {
	type?: string | undefined;
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
		stopReason: "stop",
		timestamp: Date.now(),
	};
}
