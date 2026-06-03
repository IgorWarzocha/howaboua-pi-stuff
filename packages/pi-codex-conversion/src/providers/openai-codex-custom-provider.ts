import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Image, Spacer, Text } from "@earendil-works/pi-tui";
import {
	createAssistantMessageEventStream,
	appendAssistantMessageDiagnostic,
	clampThinkingLevel,
	createAssistantMessageDiagnostic,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type Transport,
} from "@earendil-works/pi-ai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import {
	convertResponsesMessages,
	convertResponsesTools,
	CODEX_TOOL_CALL_PROVIDERS,
	processResponsesStream,
} from "./openai-responses-shared.ts";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/tool-set.ts";
import type { CodexConversionConfig } from "../adapter/config.ts";
import { rewriteNativeImageGenerationTool } from "../tools/image-generation-tool.ts";
import { rewriteNativeWebSearchTool } from "../tools/web-search-tool.ts";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
export const IMAGE_SAVE_DISPLAY_MESSAGE_TYPE = "codex-image-generation-display";
export const WEB_SEARCH_ACTIVITY_MESSAGE_TYPE = "codex-web-search-activity";
const OPENAI_CODEX_IMAGE_DIR = ".pi/openai-codex-images";
const OPENAI_CODEX_LATEST_IMAGE_NAME = "latest.png";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_SSE_HEADER_TIMEOUT_MS = 10_000;
const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;
const CODEX_RESPONSE_STATUSES = new Set(["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"]);
const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
const WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE = 1009;
const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;
const dynamicImport = (specifier: string) => import(specifier);
const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

function clampOpenAIPromptCacheKey(key: string | undefined): string | undefined {
	if (key === undefined) return undefined;
	const chars = Array.from(key);
	if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return key;
	return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}
let _os: { platform(): string; release(): string; arch(): string } | null = null;

if (typeof process !== "undefined" && (process.versions?.node || process.versions["bun"]!)) {
	dynamicImport("node:os")
		.then((module) => {
			_os = module;
		})
		.catch(() => {
			_os = null;
		});
}

interface SavedGeneratedImage {
	absolutePath: string;
	relativePath: string;
	latestAbsolutePath: string;
	latestRelativePath: string;
	responseId: string | undefined;
	callId: string;
	outputFormat: string;
	revisedPrompt?: string | undefined;
}

interface ImageDisplayMessageDetails {
	savedImages: SavedGeneratedImage[];
}

interface PendingImageDisplay {
	savedImage: SavedGeneratedImage;
	imageData: { data: string; mimeType: string };
}

interface QueuedImageActivity extends PendingImageDisplay {
	kind: "image";
}

interface SurfacedWebSearch {
	callId: string;
	status?: string | undefined;
	query?: string | undefined;
	queries: string[];
	sources: Array<{ title?: string | undefined; url: string }>;
}

interface QueuedWebSearchActivity {
	kind: "web-search";
	search: SurfacedWebSearch;
}

type PendingActivity = QueuedImageActivity | QueuedWebSearchActivity;
type SendActivityMessage = ExtensionAPI["sendMessage"];

interface CachedImagePreview {
	data: string;
	mimeType: string;
}

interface WebSocketLike {
	readyState?: number | undefined;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	removeEventListener(type: string, listener: (event: unknown) => void): void;
}

interface WebSocketConstructorLike {
	new (url: string, options?: { headers?: Record<string, string> | undefined } | string | string[]): WebSocketLike;
}

interface SessionWebSocketCacheEntry {
	socket: WebSocketLike;
	busy: boolean;
	idleTimer?: ReturnType<typeof setTimeout> | undefined;
	continuation?: CachedWebSocketContinuationState | undefined;
}

interface AcquiredWebSocket {
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

type CodexProviderStreamOptions = SimpleStreamOptions & { serviceTier?: ServiceTier | undefined; textVerbosity?: string | undefined; reasoningSummary?: string | undefined };
type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
type OpenAICodexStreamOptions = CodexProviderStreamOptions & {
	reasoningEffort?: CodexReasoningEffort | undefined;
	websocketConnectTimeoutMs?: number | undefined;
};

let fsPromisesPromise: Promise<typeof import("node:fs/promises")> | undefined;
const workspaceRootCache = new Map<string, Promise<string>>();

const PATH_SEPARATOR = "/";

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

interface ResponseEnvelope {
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

type ServiceTier = ResponseCreateParamsStreaming["service_tier"];

const websocketSessionCache = new Map<string, SessionWebSocketCacheEntry>();
class NonRetryableProviderError extends Error {}

interface StreamEventShape {
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

function sanitizeFilePart(value: string | undefined, fallback: string): string {
	const trimmed = (value ?? "").trim();
	if (!trimmed) return fallback;
	return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function shortenFilePart(value: string | undefined, fallback: string): string {
	const safe = sanitizeFilePart(value, fallback);
	const match = /^([a-zA-Z]+_)(.+)$/.exec(safe);
	const prefix = match?.[1] ?? "";
	const body = match?.[2] ?? safe;
	if (body.length <= 12) return `${prefix}${body}`;
	return `${prefix}${body.slice(0, 8)}-${body.slice(-4)}`;
}

function normalizeImageOutputFormat(value: string | undefined): string {
	const format = (value ?? "png").toLowerCase();
	return format === "png" || format === "jpg" || format === "jpeg" || format === "webp" ? format : "png";
}


function normalizePath(value: string): string {
	if (!value) return ".";
	const normalized = value.replace(/\/+/g, PATH_SEPARATOR);
	if (normalized === PATH_SEPARATOR) return normalized;
	return normalized.replace(/\/+$/g, "") || PATH_SEPARATOR;
}

function joinPaths(...parts: string[]): string {
	if (parts.length === 0) return ".";
	let result = parts[0] ?? "";
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i]!;
		if (!part) continue;
		if (!result || result.endsWith(PATH_SEPARATOR)) {
			result += part.replace(/^\/+/, "");
		} else {
			result += `${PATH_SEPARATOR}${part.replace(/^\/+/, "")}`;
		}
	}
	return normalizePath(result);
}

function dirnamePath(value: string): string {
	const normalized = normalizePath(value);
	if (normalized === PATH_SEPARATOR) return PATH_SEPARATOR;
	const index = normalized.lastIndexOf(PATH_SEPARATOR);
	if (index < 0) return ".";
	if (index === 0) return PATH_SEPARATOR;
	return normalized.slice(0, index);
}

function splitPathSegments(value: string): string[] {
	const normalized = normalizePath(value);
	if (normalized === PATH_SEPARATOR) return [];
	return normalized.replace(/^\/+/, "").split(PATH_SEPARATOR).filter(Boolean);
}

function relativePath(from: string, to: string): string {
	const normalizedFrom = normalizePath(from);
	const normalizedTo = normalizePath(to);
	if (normalizedFrom === normalizedTo) return "";
	const fromSegments = splitPathSegments(normalizedFrom);
	const toSegments = splitPathSegments(normalizedTo);
	let shared = 0;
	while (shared < fromSegments.length && shared < toSegments.length && fromSegments[shared] === toSegments[shared]!) {
		shared++;
	}
	const upSegments = new Array(fromSegments.length - shared).fill("..");
	const downSegments = toSegments.slice(shared);
	return [...upSegments, ...downSegments].join(PATH_SEPARATOR);
}

async function getNodeFsPromises(): Promise<typeof import("node:fs/promises")> {
	if (!fsPromisesPromise) {
		fsPromisesPromise = dynamicImport("node:fs/promises") as Promise<typeof import("node:fs/promises")>;
	}
	return fsPromisesPromise;
}

function getNodeFsSync(): { readFileSync(path: string): Buffer } | null {
	if (typeof process === "undefined" || !(process.versions?.node || process.versions["bun"]!)) {
		return null;
	}
	const builtinProcess = process as typeof process & { getBuiltinModule?: (specifier: string) => unknown | undefined };
	if (typeof builtinProcess.getBuiltinModule !== "function") {
		return null;
	}
	try {
		const module = builtinProcess.getBuiltinModule("node:fs") as { readFileSync?: unknown } | undefined;
		if (typeof module?.readFileSync !== "function") return null;
		return { readFileSync: module.readFileSync as (path: string) => Buffer };
	} catch {
		return null;
	}
}

async function pathExists(value: string): Promise<boolean> {
	try {
		const fs = await getNodeFsPromises();
		await fs.access(value);
		return true;
	} catch {
		return false;
	}
}

async function resolveWorkspaceRoot(cwd: string): Promise<string> {
	const normalizedCwd = normalizePath(cwd);
	const cached = workspaceRootCache.get(normalizedCwd);
	if (cached) return cached;

	const promise = (async () => {
		let current = normalizedCwd;
		while (true) {
			if (await pathExists(joinPaths(current, ".git"))) {
				return current;
			}
			const parent = dirnamePath(current);
			if (parent === current || parent === ".") {
				return normalizedCwd;
			}
			current = parent;
		}
	})();

	workspaceRootCache.set(normalizedCwd, promise);
	return promise;
}

export function getOpenAICodexImageDirectory(cwd: string): string {
	return joinPaths(cwd, OPENAI_CODEX_IMAGE_DIR);
}

export function getOpenAICodexImagePath(cwd: string, responseId: string | undefined, callId: string, outputFormat?: string): string {
	const ext = normalizeImageOutputFormat(outputFormat);
	const safeCallId = shortenFilePart(callId, "image");
	const safeResponseId = shortenFilePart(responseId, "response");
	return joinPaths(getOpenAICodexImageDirectory(cwd), `${safeCallId}-${safeResponseId}.${ext}`);
}

export function getOpenAICodexLatestImagePath(cwd: string): string {
	return joinPaths(getOpenAICodexImageDirectory(cwd), OPENAI_CODEX_LATEST_IMAGE_NAME);
}

export function buildGeneratedImageDisplayText(savedImage: SavedGeneratedImage, options?: { expanded?: boolean | undefined }): string {
	const lines: string[] = [];
	if (options?.expanded && savedImage.revisedPrompt) {
		lines.push(`Prompt: ${savedImage.revisedPrompt}`);
	}
	lines.push(`File: ${savedImage.relativePath}`);
	return lines.join("\n");
}

export async function saveOpenAICodexGeneratedImage(
	cwd: string,
	image: { responseId?: string | undefined; callId: string; result: string; outputFormat?: string | undefined; revisedPrompt?: string | undefined },
): Promise<SavedGeneratedImage> {
	const workspaceRoot = await resolveWorkspaceRoot(cwd);
	const fs = await getNodeFsPromises();
	const bytes = Buffer.from(image.result, "base64");
	const outputFormat = normalizeImageOutputFormat(image.outputFormat);
	const absolutePath = getOpenAICodexImagePath(workspaceRoot, image.responseId, image.callId, outputFormat);
	const latestAbsolutePath = getOpenAICodexLatestImagePath(workspaceRoot);
	await fs.mkdir(dirnamePath(absolutePath), { recursive: true });
	await fs.writeFile(absolutePath, bytes);
	await fs.writeFile(latestAbsolutePath, bytes);

	const relativeFilePath = relativePath(workspaceRoot, absolutePath);
	const latestRelativeFilePath = relativePath(workspaceRoot, latestAbsolutePath);
	const relativePathValue = relativeFilePath && !relativeFilePath.startsWith("..") ? relativeFilePath : absolutePath;
	const latestRelativePathValue =
		latestRelativeFilePath && !latestRelativeFilePath.startsWith("..") ? latestRelativeFilePath : latestAbsolutePath;

	return {
		absolutePath,
		relativePath: relativePathValue,
		latestAbsolutePath,
		latestRelativePath: latestRelativePathValue,
		responseId: image.responseId,
		callId: image.callId,
		outputFormat,
		revisedPrompt: image.revisedPrompt,
	};
}

function extractAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString("utf8"));
		const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		if (!accountId) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

function resolveCodexUrl(baseUrl: string | undefined): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

function resolveCodexWebSocketUrl(baseUrl: string | undefined): string {
	const url = new URL(resolveCodexUrl(baseUrl));
	if (url.protocol === "https:") url.protocol = "wss:";
	if (url.protocol === "http:") url.protocol = "ws:";
	return url.toString();
}

function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}

function createCodexRequestId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `codex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildBaseCodexHeaders(
	modelHeaders: Record<string, string> | undefined,
	additionalHeaders: Record<string, string> | undefined,
	accountId: string,
	token: string,
): Headers {
	const headers = new Headers(modelHeaders);
	for (const [key, value] of Object.entries(additionalHeaders ?? {})) {
		headers.set(key, value);
	}

	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("originator", "pi");
	headers.set("User-Agent", _os ? `pi (${_os.platform()} ${_os.release()}; ${_os.arch()})` : "pi (browser)");
	return headers;
}

function buildSSEHeaders(
	modelHeaders: Record<string, string> | undefined,
	additionalHeaders: Record<string, string> | undefined,
	accountId: string,
	token: string,
	sessionId: string | undefined,
): Headers {
	const headers = buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");

	if (sessionId) {
		headers.set("session-id", sessionId);
		headers.set("x-client-request-id", sessionId);
	}

	return headers;
}

function buildWebSocketHeaders(
	modelHeaders: Record<string, string> | undefined,
	additionalHeaders: Record<string, string> | undefined,
	accountId: string,
	token: string,
	requestId: string,
): Headers {
	const headers = buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token);
	headers.delete("accept");
	headers.delete("content-type");
	headers.delete("OpenAI-Beta");
	headers.delete("openai-beta");
	headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
	headers.set("x-client-request-id", requestId);
	headers.set("session-id", requestId);
	return headers;
}

function clampReasoningEffort(modelId: string, effort: string): string {
	if (effort === "none") return effort;
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	const gpt5MinorMatch = /^gpt-5\.(\d+)/.exec(id);
	const gpt5Minor = gpt5MinorMatch ? Number.parseInt(gpt5MinorMatch[1]!, 10) : undefined;
	if (gpt5Minor !== undefined && gpt5Minor >= 2 && effort === "minimal") return "low";
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini") return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

function getServiceTierCostMultiplier(model: Model<Api>, serviceTier: ServiceTier): number {
	switch (serviceTier) {
		case "flex":
			return 0.5;
		case "priority":
			return model.id === "gpt-5.5" ? 2.5 : 2;
		default:
			return 1;
	}
}

function applyServiceTierPricing(usage: AssistantMessage["usage"], serviceTier: ServiceTier, model: Model<Api>): void {
	const multiplier = getServiceTierCostMultiplier(model, serviceTier);
	if (multiplier === 1) return;
	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

function resolveCodexServiceTier(responseServiceTier: ServiceTier, requestServiceTier: ServiceTier): ServiceTier {
	if (responseServiceTier === "default" && (requestServiceTier === "flex" || requestServiceTier === "priority")) {
		return requestServiceTier;
	}
	return responseServiceTier ?? requestServiceTier;
}

export function buildRequestBody<TApi extends Api>(model: Model<TApi>, context: Context, options?: OpenAICodexStreamOptions): ResponsesBody {
	const messages = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
		includeSystemPrompt: false,
	});

	const body: ResponsesBody = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt || "You are a helpful assistant.",
		input: messages,
		text: { verbosity: ((options as { textVerbosity?: string | undefined } | undefined)?.textVerbosity ?? "low") as string },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: clampOpenAIPromptCacheKey(options?.sessionId),
		tool_choice: "auto",
		parallel_tool_calls: true,
	};

	// The Codex ChatGPT-backed endpoint rejects output-token cap fields with
	// `Unsupported parameter: max_output_tokens`. Pi's branch summarizer passes
	// `maxTokens`, so forwarding it breaks `/tree` summaries and extensions that
	// use `ctx.navigateTree(..., { summarize: true })`.

	if ((options as { temperature?: number | undefined } | undefined)?.temperature !== undefined) {
		body.temperature = (options as { temperature?: number | undefined }).temperature;
	}

	const serviceTier = (options as { serviceTier?: string | undefined } | undefined)?.serviceTier;
	if (serviceTier !== undefined) {
		body.service_tier = serviceTier;
	}

	if (context.tools && context.tools.length > 0) {
		body.tools = convertResponsesTools(context.tools, { strict: null });
		const hasWebSearchTool = context.tools.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME);
		if (hasWebSearchTool) {
			body.include.push("web_search_call.action.sources", "web_search_call.results");
		}
	}

	const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	const reasoningEffort = options?.reasoningEffort ?? (clampedReasoning === "off" ? undefined : clampedReasoning);
	if (reasoningEffort !== undefined) {
		const effort = reasoningEffort === "none" ? (model.thinkingLevelMap?.off ?? "none") : (model.thinkingLevelMap?.[reasoningEffort] ?? reasoningEffort);
		if (effort === null) return body;
		body.reasoning = {
			effort: clampReasoningEffort(model.id, effort),
			summary: ((options as { reasoningSummary?: string | undefined } | undefined)?.reasoningSummary ?? "auto") as string,
		};
	}

	return body;
}

function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}

		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new Error("Request was aborted"));
			},
			{ once: true },
		);
	});
}

function normalizeTimeoutMs(value: number | undefined, optionName: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid ${optionName}: ${String(value)}`);
	}
	return Math.floor(value);
}

function validateWebSocketTimeoutOptions(options: OpenAICodexStreamOptions | undefined): void {
	normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
	normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
	for (const signal of signals) {
		if (!signal) continue;
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		const listener = () => controller.abort(signal.reason);
		signal.addEventListener("abort", listener);
		listeners.push({ signal, listener });
	}
	return {
		signal: controller.signal,
		cleanup: () => {
			for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
		},
	};
}

function createSSEHeaderTimeout(): { signal: AbortSignal; clear: () => void; error: () => Error | undefined } {
	const controller = new AbortController();
	let error: Error | undefined;
	const timeout = setTimeout(() => {
		error = new Error(`Codex SSE response headers timed out after ${DEFAULT_SSE_HEADER_TIMEOUT_MS}ms`);
		controller.abort(error);
	}, DEFAULT_SSE_HEADER_TIMEOUT_MS);
	return {
		signal: controller.signal,
		clear: () => clearTimeout(timeout),
		error: () => error,
	};
}

export async function* parseSSE(response: Response, signal?: AbortSignal): AsyncIterable<StreamEventShape> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			const { done, value } = await reader.read();
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
			let idx = buffer.indexOf("\n\n");
			while (idx !== -1) {
				const chunk = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const dataLines = chunk
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trim());
				if (dataLines.length > 0) {
					const data = dataLines.join("\n").trim();
					if (data && data !== "[DONE]") {
						try {
							yield JSON.parse(data) as StreamEventShape;
						} catch (error) {
							throw new Error(`Invalid Codex SSE JSON: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}
				idx = buffer.indexOf("\n\n");
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {
			// ignore cancellation errors
		}
		try {
			reader.releaseLock();
		} catch {
			// ignore lock release errors
		}
	}
}

let _cachedWebSocket: WebSocketConstructorLike | null = null;
async function getWebSocketConstructor(): Promise<WebSocketConstructorLike | null> {
	if (_cachedWebSocket) return _cachedWebSocket;
	if (
		typeof process !== "undefined" &&
		process.versions["bun"]! &&
		(process.env["HTTP_PROXY"] || process.env["HTTPS_PROXY"]! || process.env["http_proxy"]! || process.env["https_proxy"]!)
	) {
		const module = await dynamicImport("proxy-from-env");
		const getProxyForUrl = (module as { getProxyForUrl: (url: string | object | URL) => string }).getProxyForUrl;
		_cachedWebSocket = class extends WebSocket {
			constructor(url: string, options?: { headers?: Record<string, string> | undefined } | string | string[]) {
				const proxy = getProxyForUrl(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
				const baseOptions = Array.isArray(options) || typeof options === "string" ? { protocols: options } : { ...options };
				super(url, { ...baseOptions, ...(proxy ? { proxy } : {}) } as never);
			}
		};
		return _cachedWebSocket;
	}
	const ctor = (globalThis as typeof globalThis & { WebSocket?: WebSocketConstructorLike | undefined }).WebSocket;
	return typeof ctor === "function" ? ctor : null;
}

function getWebSocketReadyState(socket: WebSocketLike): number | undefined {
	return typeof socket.readyState === "number" ? socket.readyState : undefined;
}

function isWebSocketReusable(socket: WebSocketLike): boolean {
	const readyState = getWebSocketReadyState(socket);
	return readyState === undefined || readyState === 1;
}

function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
	try {
		socket.close(code, reason);
	} catch {
		// ignore close errors
	}
}


export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
	const closeEntry = (entry: SessionWebSocketCacheEntry) => {
		if (entry.idleTimer) {
			clearTimeout(entry.idleTimer);
			entry.idleTimer = undefined;
		}
		closeWebSocketSilently(entry.socket, 1000, "session_shutdown");
	};

	if (sessionId) {
		const entry = websocketSessionCache.get(sessionId);
		if (entry) closeEntry(entry);
		websocketSessionCache.delete(sessionId);
		return;
	}

	for (const entry of websocketSessionCache.values()) {
		closeEntry(entry);
	}
	websocketSessionCache.clear();
}


function scheduleSessionWebSocketExpiry(cacheKey: string, entry: SessionWebSocketCacheEntry): void {
	if (entry.idleTimer) {
		clearTimeout(entry.idleTimer);
	}
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
		websocketSessionCache.delete(cacheKey);
	}, SESSION_WEBSOCKET_CACHE_TTL_MS);
}

function extractWebSocketError(event: unknown): Error {
	if (event && typeof event === "object" && "message" in event) {
		const message = (event as { message?: unknown | undefined }).message;
		if (typeof message === "string" && message.length > 0) {
			return new Error(message);
		}
	}
	return new Error("WebSocket error");
}

function extractWebSocketCloseError(event: unknown): Error {
	if (event && typeof event === "object") {
		const code = "code" in event ? (event as { code?: unknown | undefined }).code : undefined;
		const reason = "reason" in event ? (event as { reason?: unknown | undefined }).reason : undefined;
		const codeText = typeof code === "number" ? ` ${code}` : "";
		let reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
		if (!reasonText && code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE) {
			reasonText = " message too big";
		}
		return new Error(`WebSocket closed${codeText}${reasonText}`.trim());
	}
	return new Error("WebSocket closed");
}

async function connectWebSocket(url: string, headers: Headers, signal: AbortSignal | undefined, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS): Promise<WebSocketLike> {
	const WebSocketCtor = await getWebSocketConstructor();
	if (!WebSocketCtor) {
		throw new Error("WebSocket transport is not available in this runtime");
	}

	const wsHeaders = headersToRecord(headers);
	delete wsHeaders["OpenAI-Beta"];

	return new Promise((resolve, reject) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let socket: WebSocketLike;

		try {
			socket = new WebSocketCtor(url, { headers: wsHeaders });
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		const onOpen = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(socket);
		};
		const onError = (event: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(extractWebSocketError(event));
		};
		const onClose = (event: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(extractWebSocketCloseError(event));
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			closeWebSocketSilently(socket, 1000, "aborted");
			reject(new Error("Request was aborted"));
		};

		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			signal?.removeEventListener("abort", onAbort);
		};

		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		signal?.addEventListener("abort", onAbort);
		if (connectTimeoutMs > 0) {
			timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				cleanup();
				closeWebSocketSilently(socket, 1000, "connect_timeout");
				reject(new Error(`WebSocket connect timeout after ${connectTimeoutMs}ms`));
			}, connectTimeoutMs);
		}
		if (signal?.aborted) onAbort();
	});
}

async function acquireWebSocket(
	url: string,
	headers: Headers,
	sessionId: string | undefined,
	signal: AbortSignal | undefined,
	connectTimeoutMs?: number,
): Promise<AcquiredWebSocket> {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
		return {
			socket,
			reused: false,
			release: ({ keep } = {}) => {
				if (keep === false) {
					closeWebSocketSilently(socket);
					return;
				}
				closeWebSocketSilently(socket);
			},
		};
	}

	const cached = websocketSessionCache.get(sessionId);
	if (cached) {
		if (cached.idleTimer) {
			clearTimeout(cached.idleTimer);
			cached.idleTimer = undefined;
		}

		if (!cached.busy && isWebSocketReusable(cached.socket)) {
			cached.busy = true;
			return {
				socket: cached.socket,
				entry: cached,
				reused: true,
				release: ({ keep } = {}) => {
					if (!keep || !isWebSocketReusable(cached.socket)) {
						closeWebSocketSilently(cached.socket);
						websocketSessionCache.delete(sessionId);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(sessionId, cached);
				},
			};
		}

		if (cached.busy) {
			const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
			return {
				socket,
				reused: false,
				release: () => {
					closeWebSocketSilently(socket);
				},
			};
		}

		if (!isWebSocketReusable(cached.socket)) {
			closeWebSocketSilently(cached.socket);
			websocketSessionCache.delete(sessionId);
		}
	}

	const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
	const entry: SessionWebSocketCacheEntry = { socket, busy: true };
	websocketSessionCache.set(sessionId, entry);
	return {
		socket,
		entry,
		reused: false,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				if (websocketSessionCache.get(sessionId) === entry) {
					websocketSessionCache.delete(sessionId);
				}
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(sessionId, entry);
		},
	};
}

async function decodeWebSocketData(data: unknown): Promise<string | null> {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(data));
	}
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}
	if (data && typeof data === "object" && "arrayBuffer" in data) {
		const arrayBuffer = await (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
		return new TextDecoder().decode(new Uint8Array(arrayBuffer));
	}
	return null;
}

export function requestBodyForWebSocketContinuationComparison(body: ResponsesBody): ResponsesBody {
	const {
		input: _input,
		previous_response_id: _previousResponseId,
		// Reasoning is a per-turn generation option. It is not part of the
		// session/thread prompt cache key, and the Responses API accepts it on the
		// follow-up request alongside previous_response_id. Keep WebSocket
		// continuation reuse when the user only changes thinking level.
		reasoning: _reasoning,
		...rest
	} = body;
	return rest as ResponsesBody;
}

function responseInputsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
	return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function requestBodiesMatchExceptInput(a: ResponsesBody, b: ResponsesBody): boolean {
	return JSON.stringify(requestBodyForWebSocketContinuationComparison(a)) === JSON.stringify(requestBodyForWebSocketContinuationComparison(b));
}

function getFunctionCallId(item: unknown): string | undefined {
	return item && typeof item === "object" && (item as { type?: unknown }).type === "function_call" && typeof (item as { call_id?: unknown }).call_id === "string"
		? (item as { call_id: string }).call_id
		: undefined;
}

function getFunctionCallOutputId(item: unknown): string | undefined {
	return item && typeof item === "object" && (item as { type?: unknown }).type === "function_call_output" && typeof (item as { call_id?: unknown }).call_id === "string"
		? (item as { call_id: string }).call_id
		: undefined;
}

function getPendingToolOutputDelta(body: ResponsesBody, continuation: CachedWebSocketContinuationState): unknown[] | undefined {
	const pendingCallIds = continuation.lastResponseItems.map(getFunctionCallId).filter((id): id is string => id !== undefined);
	if (pendingCallIds.length === 0) return undefined;

	const pending = new Set(pendingCallIds);
	const currentInput = body.input ?? [];
	let firstOutputIndex: number | undefined;
	for (const [index, item] of currentInput.entries()) {
		const callId = getFunctionCallOutputId(item);
		if (!callId || !pending.has(callId)) continue;
		firstOutputIndex ??= index;
		pending.delete(callId);
	}

	return pending.size === 0 && firstOutputIndex !== undefined ? currentInput.slice(firstOutputIndex) : undefined;
}

function getCachedWebSocketInputDelta(body: ResponsesBody, continuation: CachedWebSocketContinuationState): { delta?: unknown[] | undefined; decision: WebSocketContinuationDecision } {
	if (!requestBodiesMatchExceptInput(body, continuation.lastRequestBody)) {
		return { decision: "body_mismatch" };
	}

	const currentInput = body.input ?? [];
	const baseline = [...(continuation.lastRequestBody.input ?? []), ...continuation.lastResponseItems];
	if (currentInput.length < baseline.length) {
		return { decision: "input_shorter_than_baseline" };
	}

	const prefix = currentInput.slice(0, baseline.length);
	if (!responseInputsEqual(prefix, baseline)) {
		const pendingToolOutputDelta = getPendingToolOutputDelta(body, continuation);
		if (pendingToolOutputDelta) {
			return { delta: pendingToolOutputDelta, decision: "delta" };
		}
		return { decision: "input_prefix_mismatch" };
	}

	return { delta: currentInput.slice(baseline.length), decision: "delta" };
}

export function buildCachedWebSocketRequestBody(continuation: CachedWebSocketContinuationState | undefined, body: ResponsesBody): CachedWebSocketRequestBodyResult {
	if (!continuation) {
		return { body, decision: "no_continuation" };
	}

	const { delta, decision } = getCachedWebSocketInputDelta(body, continuation);
	if (!delta) {
		return { body, decision };
	}
	if (!continuation.lastResponseId) {
		return { body, decision: "missing_previous_response_id" };
	}

	return {
		body: {
			...body,
			previous_response_id: continuation.lastResponseId,
			input: delta,
		},
		decision: "delta",
	};
}

async function* parseWebSocket(socket: WebSocketLike, signal: AbortSignal | undefined, idleTimeoutMs?: number): AsyncIterable<StreamEventShape> {
	const queue: StreamEventShape[] = [];
	let pending: (() => void) | null = null;
	let done = false;
	let failed: Error | null = null;
	let closeError: Error | null = null;
	let sawCompletion = false;
	let pendingMessages = 0;
	let messageChain = Promise.resolve();

	const wake = () => {
		if (!pending) return;
		const resolve = pending;
		pending = null;
		resolve();
	};

	const onMessage = (event: unknown) => {
		pendingMessages++;
		wake();
		messageChain = messageChain
			.then(async () => {
				if (!event || typeof event !== "object" || !("data" in event)) return;
				const text = await decodeWebSocketData((event as { data?: unknown | undefined }).data);
				if (!text) return;
				try {
					const parsed = JSON.parse(text) as StreamEventShape;
					const type = typeof parsed.type === "string" ? parsed.type : "";
					if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
						sawCompletion = true;
						closeError = null;
						done = true;
					}
					queue.push(parsed);
				} catch (error) {
					failed = new Error(`Invalid Codex WebSocket JSON: ${error instanceof Error ? error.message : String(error)}`);
					done = true;
				}
			})
			.catch((error: unknown) => {
				failed = error instanceof Error ? error : new Error(String(error));
				done = true;
			})
			.finally(() => {
				pendingMessages--;
				wake();
			});
	};

	const onError = (event: unknown) => {
		failed = extractWebSocketError(event);
		done = true;
		wake();
	};

	const onClose = (event: unknown) => {
		if (sawCompletion) {
			done = true;
			wake();
			return;
		}
		if (!closeError) {
			closeError = extractWebSocketCloseError(event);
		}
		done = true;
		wake();
	};

	const onAbort = () => {
		failed = new Error("Request was aborted");
		done = true;
		wake();
	};

	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", onError);
	socket.addEventListener("close", onClose);
	signal?.addEventListener("abort", onAbort);

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (queue.length > 0) {
				yield queue.shift() as StreamEventShape;
				continue;
			}
			if (done && pendingMessages === 0) break;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			await new Promise<void>((resolve) => {
				pending = resolve;
				if (pendingMessages === 0 && idleTimeoutMs && idleTimeoutMs > 0) {
					timeout = setTimeout(() => {
						failed = new Error(`WebSocket idle timeout after ${idleTimeoutMs}ms`);
						done = true;
						wake();
					}, idleTimeoutMs);
				}
			}).finally(() => {
				if (timeout) clearTimeout(timeout);
			});
		}

		if (failed) throw failed;
		if (closeError && !sawCompletion) throw closeError;
		if (!sawCompletion) {
			throw new Error("WebSocket stream closed before response.completed");
		}
	} finally {
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", onError);
		socket.removeEventListener("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function* countWebSocketEvents(
	events: AsyncIterable<StreamEventShape>,
	onEvent: () => void,
): AsyncIterable<StreamEventShape> {
	for await (const event of events) {
		onEvent();
		yield event;
	}
}

async function* startWebSocketOutputOnFirstEvent(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	onStart: () => void,
): AsyncIterable<StreamEventShape> {
	let started = false;
	for await (const event of events) {
		if (!started) {
			started = true;
			onStart();
			stream.push({ type: "start", partial: output });
		}
		yield event;
	}
}

function isRetryableEarlyWebSocketError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	if (/message too big/i.test(message)) return false;
	return /^(?:WebSocket (?:error|closed|connect timeout)(?:\s|$)|Invalid Codex WebSocket JSON)/.test(message);
}

async function* mapCodexEvents(events: AsyncIterable<StreamEventShape>): AsyncIterable<StreamEventShape> {
	let sawTerminalResponse = false;
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;

		if (type === "error") {
			throw new Error(`Codex error: ${event.message || event.code || JSON.stringify(event)}`);
		}

		if (type === "response.failed") {
			throw new Error(event.response?.error?.message || "Codex response failed");
		}

		if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
			sawTerminalResponse = true;
			const response = event.response;
			yield {
				...event,
				type: "response.completed",
				response: response ? { ...response, status: normalizeCodexStatus(response.status) } : response,
			};
			return;
		}

		yield event;
	}

	if (!sawTerminalResponse) {
		throw new Error("Stream closed before response.completed");
	}
}

function normalizeCodexStatus(status: string | undefined): string | undefined {
	if (typeof status !== "string") return undefined;
	return CODEX_RESPONSE_STATUSES.has(status) ? status : undefined;
}

function getLatestUserText(context: Context): string | undefined {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const message = context.messages[i]!;
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			const trimmed = message.content.trim();
			if (trimmed) return trimmed;
			continue;
		}
		const text = message.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

async function* captureGeneratedImages(
	events: AsyncIterable<StreamEventShape>,
	options: {
		cwd: string;
		requestPrompt?: string | undefined;
		onImageSaved: (image: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
): AsyncIterable<StreamEventShape> {
	let responseId: string | undefined;

	for await (const event of events) {
		if (event.type === "response.created" && event.response?.id) {
			responseId = event.response.id;
		}

		if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") {
			const callId = typeof event.item.id === "string" ? event.item.id : undefined;
			const result = typeof event.item.result === "string" ? event.item.result : undefined;
			if (callId && result) {
				try {
					const outputFormat = typeof event.item.output_format === "string" ? event.item.output_format : undefined;
					const normalizedOutputFormat = normalizeImageOutputFormat(outputFormat);
					const saved = await saveOpenAICodexGeneratedImage(options.cwd, {
						responseId,
						callId,
						result,
						outputFormat: normalizedOutputFormat,
						revisedPrompt:
							typeof event.item.revised_prompt === "string" ? event.item.revised_prompt : options.requestPrompt,
					});
					options.onImageSaved(saved, {
						data: result,
						mimeType: `image/${normalizedOutputFormat}`,
					});
				} catch (error) {
					console.warn("[pi-codex-conversion] Failed to save generated image", error);
				}
			}
		}

		if (event.type === "response.output_item.done" && event.item?.type === "web_search_call") {
			const search = extractWebSearch(event.item);
			if (search) {
				options.onWebSearchCaptured?.(search);
			}
		}

		yield event;
	}
}

async function processCapturedResponsesStream<TApi extends Api>(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options: OpenAICodexStreamOptions | undefined,
	deps: {
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
	cwd: string,
	requestPrompt: string | undefined,
): Promise<void> {
	const tappedEvents = captureGeneratedImages(mapCodexEvents(events), {
		cwd,
		requestPrompt,
		onImageSaved: (image, imageData) => deps.onImageSaved?.(image, imageData),
		onWebSearchCaptured: (search) => deps.onWebSearchCaptured?.(search),
	});

	await processResponsesStream(tappedEvents as AsyncIterable<never>, output, stream, model, {
		serviceTier: (options as { serviceTier?: ServiceTier | undefined } | undefined)?.serviceTier,
		resolveServiceTier: resolveCodexServiceTier,
		applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model as Model<Api>),
	});
}

async function processWebSocketStream<TApi extends Api>(
	url: string,
	body: ResponsesBody,
	headers: Headers,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	onStart: () => void,
	options: SimpleStreamOptions | undefined,
	deps: {
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
	cwd: string,
	requestPrompt: string | undefined,
): Promise<void> {
	let streamStarted = false;
	const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");

	for (let attempt = 0; attempt < 2; attempt++) {
		const { socket, entry, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal, websocketConnectTimeoutMs);
		let keepConnection = true;
		let released = false;
		let eventCount = 0;
		const transport = (options as { transport?: string | undefined } | undefined)?.transport ?? "auto";
		const useCachedContext = transport === "websocket-cached" || transport === "auto";
		// ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
		// WebSocket continuation still works via connection-scoped previous_response_id state.
		const fullBody = body;
		const cachedRequest = useCachedContext && entry
			? buildCachedWebSocketRequestBody(entry.continuation, fullBody)
			: { body: fullBody, decision: useCachedContext ? "no_session_cache_entry" : "disabled" } satisfies CachedWebSocketRequestBodyResult;
		const requestBody = cachedRequest.body;

		const releaseOnce = (releaseOptions?: { keep?: boolean | undefined }) => {
			if (released) return;
			released = true;
			release(releaseOptions);
		};

		try {
			socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
			await processCapturedResponsesStream(
				startWebSocketOutputOnFirstEvent(
					countWebSocketEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs), () => {
						eventCount++;
					}),
					output,
					stream,
					() => {
						streamStarted = true;
						onStart();
					},
				),
				output,
				stream,
				model,
				options,
				deps,
				cwd,
				requestPrompt,
			);
			if (options?.signal?.aborted) {
				keepConnection = false;
			} else if (useCachedContext && entry && output.responseId) {
				const responseItems = convertResponsesMessages(model, { messages: [output] }, CODEX_TOOL_CALL_PROVIDERS, {
					includeSystemPrompt: false,
				}).filter((item) => typeof item === "object" && item !== null && (item as { type?: unknown | undefined }).type !== "function_call_output");
				entry.continuation = {
					lastRequestBody: fullBody,
					lastResponseId: output.responseId,
					lastResponseItems: responseItems,
				};
			}
			releaseOnce({ keep: keepConnection });
			return;
		} catch (error) {
			if (entry) {
				entry.continuation = undefined;
			}
			keepConnection = false;
			releaseOnce({ keep: false });
			// If WebSocket fails before the first response event, nothing has been
			// emitted to the UI/history yet. Retry once on a fresh WebSocket; if that
			// also fails, the caller can fall back to SSE for `auto` transport.
			if (attempt === 0 && eventCount === 0 && !streamStarted && !options?.signal?.aborted && isRetryableEarlyWebSocketError(error)) {
				continue;
			}
			throw error;
		} finally {
			releaseOnce({ keep: keepConnection });
		}
	}
}

function extractWebSearch(item: StreamEventShape["item"]): SurfacedWebSearch | undefined {
	if (!item || item.type !== "web_search_call") return undefined;
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) return undefined;

	const action = typeof item["action"]! === "object" && item["action"] !== null ? (item["action"]! as Record<string, unknown>) : undefined;
	const query = typeof action?.["query"] === "string" ? action["query"]! : undefined;
	const queries = Array.isArray(action?.["queries"]) ? action["queries"]!.filter((value): value is string => typeof value === "string") : [];
	const sourceUrls = Array.isArray(action?.["sources"])
		? action["sources"]!
				.map((source) => (typeof source === "object" && source !== null ? (source as Record<string, unknown>) : undefined))
				.map((source) => (typeof source?.["url"] === "string" ? source["url"]! : undefined))
				.filter((url): url is string => typeof url === "string")
		: [];

	const results = Array.isArray(item["results"]!)
		? item["results"]!
				.map((result) => (typeof result === "object" && result !== null ? (result as Record<string, unknown>) : undefined))
				.filter((result): result is Record<string, unknown> => !!result)
		: [];

	const titledSources: Array<{ title?: string | undefined; url: string }> = [];
	for (const result of results) {
		if (typeof result["url"]! !== "string") continue;
		titledSources.push({
			title: typeof result["title"]! === "string" ? result["title"]! : undefined,
			url: result["url"]!,
		});
	}

	const seenUrls = new Set<string>();
	const sources: Array<{ title?: string | undefined; url: string }> = [];
	for (const source of titledSources) {
		if (seenUrls.has(source.url)) continue;
		seenUrls.add(source.url);
		sources.push(source);
	}
	for (const url of sourceUrls) {
		if (seenUrls.has(url)) continue;
		seenUrls.add(url);
		sources.push({ url });
	}

	return {
		callId,
		status: typeof item.status === "string" ? item.status : undefined,
		query,
		queries,
		sources,
	};
}

export function buildWebSearchActivityMessage(searches: SurfacedWebSearch[]): string {
	const sections = searches.map((search, index) => {
		const heading = searches.length > 1 ? `Web search results ${index + 1}` : "Web search results";
		const lines = [heading];
		const queries = search.queries.length > 0 ? search.queries : search.query ? [search.query] : [];
		if (queries.length > 0) {
			lines.push("Queries:");
			for (const query of queries) {
				lines.push(`- ${query}`);
			}
		}
		if (search.sources.length > 0) {
			lines.push("Sources:");
			for (const source of search.sources.slice(0, 5)) {
				lines.push(`- ${source.title ? `${source.title} — ` : ""}${source.url}`);
			}
		}
		return lines.join("\n");
	});

	return sections.join("\n\n");
}

export function buildWebSearchSummaryText(searches: SurfacedWebSearch[]): string {
	return searches.length === 1 ? "Searched the web once" : `Searched the web ${searches.length} times`;
}

function sendActivityMessages(
	sendMessage: SendActivityMessage,
	imagePreviewCache: Map<string, CachedImagePreview>,
	activities: PendingActivity[],
): void {
	for (let index = 0; index < activities.length; index++) {
		const activity = activities[index]!;
		if (activity.kind === "image") {
			imagePreviewCache.set(activity.savedImage.absolutePath, activity.imageData);
			sendMessage(
				{
					customType: IMAGE_SAVE_DISPLAY_MESSAGE_TYPE,
					content: [{ type: "text", text: buildGeneratedImageDisplayText(activity.savedImage, { expanded: false }) }],
					display: true,
					details: { savedImages: [activity.savedImage] } satisfies ImageDisplayMessageDetails,
				},
				{ triggerTurn: false },
			);
			continue;
		}

		const searches = [activity.search];
		while (index + 1 < activities.length && (activities[index + 1])!?.kind === "web-search") {
			searches.push((activities[++index]! as QueuedWebSearchActivity).search);
		}
		sendMessage(
			{
				customType: WEB_SEARCH_ACTIVITY_MESSAGE_TYPE,
				content: buildWebSearchActivityMessage(searches),
				display: true,
				details: { searches },
			},
			{ triggerTurn: false },
		);
	}
}

export function createActivityMessageDispatcher(sendMessage: SendActivityMessage): {
	imagePreviewCache: Map<string, CachedImagePreview>;
	enqueueSettledActivities(activities: PendingActivity[]): void;
	flushNow(): void;
	scheduleFlush(): void;
	clear(): void;
} {
	const completedActivities: PendingActivity[] = [];
	const imagePreviewCache = new Map<string, CachedImagePreview>();
	let pendingFlushTimer: ReturnType<typeof setTimeout> | undefined;

	const flush = () => {
		pendingFlushTimer = undefined;
		const activities = completedActivities.splice(0, completedActivities.length);
		if (activities.length > 0) sendActivityMessages(sendMessage, imagePreviewCache, activities);
	};

	return {
		imagePreviewCache,
		enqueueSettledActivities(activities) {
			completedActivities.push(...activities);
		},
		flushNow() {
			if (pendingFlushTimer) {
				clearTimeout(pendingFlushTimer);
				pendingFlushTimer = undefined;
			}
			flush();
		},
		scheduleFlush() {
			if (pendingFlushTimer || completedActivities.length === 0) return;
			pendingFlushTimer = setTimeout(flush, 0);
		},
		clear() {
			if (pendingFlushTimer) {
				clearTimeout(pendingFlushTimer);
				pendingFlushTimer = undefined;
			}
			completedActivities.length = 0;
			imagePreviewCache.clear();
		},
	};
}

function loadCachedImagePreview(savedImage: SavedGeneratedImage, imagePreviewCache: Map<string, CachedImagePreview>): CachedImagePreview | undefined {
	const cached = imagePreviewCache.get(savedImage.absolutePath);
	if (cached) return cached;
	const fs = getNodeFsSync();
	if (!fs) return undefined;
	try {
		const preview = {
			data: fs.readFileSync(savedImage.absolutePath).toString("base64"),
			mimeType: `image/${savedImage.outputFormat}`,
		};
		imagePreviewCache.set(savedImage.absolutePath, preview);
		return preview;
	} catch {
		return undefined;
	}
}

function createInitialAssistantMessage<TApi extends Api>(model: Model<TApi>): AssistantMessage {
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

function createErrorMessage(message: AssistantMessage, error: unknown, aborted: boolean): AssistantMessage {
	for (const block of message.content) {
		if (typeof block === "object" && block !== null && "partialJson" in block) {
			delete (block as { partialJson?: string | undefined }).partialJson;
		}
	}
	message.stopReason = aborted ? "aborted" : "error";
	message.errorMessage = buildProviderErrorMessage(error);
	return message;
}

export function buildProviderErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/^(?:WebSocket (?:error|closed|connect timeout|idle timeout)|WebSocket stream closed before response\.completed|Stream closed before response\.completed)/.test(message)) {
		return `Connection error: ${message}`;
	}
	return message;
}

function finalizeUsage<TApi extends Api>(_model: Model<TApi>, output: AssistantMessage): void {
	output.usage.cost.total = output.usage.cost.input + output.usage.cost.output + output.usage.cost.cacheRead + output.usage.cost.cacheWrite;
}

async function parseErrorResponse(response: Response): Promise<{ message: string; friendlyMessage?: string | undefined }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;

	try {
		const parsed = JSON.parse(raw) as { error?: { code?: string | undefined; type?: string | undefined; plan_type?: string | undefined; resets_at?: number | undefined; message?: string | undefined } | undefined };
		const err = parsed?.error;
		if (err) {
			const code = err.code || err.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				const mins = err.resets_at ? Math.max(0, Math.round((err.resets_at * 1000 - Date.now()) / 60000)) : undefined;
				const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = err.message || friendlyMessage || message;
		}
	} catch {
		// ignore malformed error bodies
	}

	return { message, friendlyMessage };
}

export function getEffectiveCodexTransport(
	transport: Transport | undefined,
	config: Pick<CodexConversionConfig, "forceCachedWebSockets"> | undefined,
): Transport {
	const configuredTransport = transport ?? "auto";
	if (config?.forceCachedWebSockets === false) return configuredTransport;
	if (configuredTransport === "websocket") return "websocket-cached";
	return configuredTransport;
}

function createCodexStream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: CodexProviderStreamOptions | undefined,
	deps: {
		getCurrentCwd: () => string;
		getConfig?: () => Pick<CodexConversionConfig, "forceCachedWebSockets"> | undefined;
		getNativeToolRewriteConfig?: () => { webSearch: boolean; imageGeneration: boolean } | undefined;
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
		onStreamSettled?: () => void | undefined;
	},
): AssistantMessageEventStream {
	const effectiveTransport = getEffectiveCodexTransport(options?.transport, deps.getConfig?.());
	const effectiveOptions: OpenAICodexStreamOptions | undefined = options
		? { ...options, transport: effectiveTransport }
		: { transport: effectiveTransport };
	const stream = createAssistantMessageEventStream();
	const requestCwd = deps.getCurrentCwd();

	(async () => {
		const output = createInitialAssistantMessage(model);
		const requestPrompt = getLatestUserText(context);

		try {
			const apiKey = effectiveOptions?.apiKey;
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = extractAccountId(apiKey);
			let body = buildRequestBody(model, context, effectiveOptions);
			const nextBody = await effectiveOptions?.onPayload?.(body, model);
			if (nextBody !== undefined) {
				body = nextBody as ResponsesBody;
			}
			const nativeToolRewriteConfig = deps.getNativeToolRewriteConfig?.();
			if (nativeToolRewriteConfig?.webSearch) {
				body = rewriteNativeWebSearchTool(body, model) as ResponsesBody;
			}
			if (nativeToolRewriteConfig?.imageGeneration) {
				body = rewriteNativeImageGenerationTool(body, model) as ResponsesBody;
			}

			const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
			const sseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId);
			const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId);
			const bodyJson = JSON.stringify(body);
			const transport = effectiveOptions.transport ?? "auto";

			if (transport !== "sse") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				let websocketStarted = false;
				try {
					await processWebSocketStream(
						resolveCodexWebSocketUrl(model.baseUrl),
						body,
						websocketHeaders,
						output,
						stream,
						model,
						() => {
							websocketStarted = true;
						},
						effectiveOptions,
						deps,
						requestCwd,
						requestPrompt,
					);
					if (effectiveOptions?.signal?.aborted) {
						throw new Error("Request was aborted");
					}
					finalizeUsage(model, output);
					stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
					stream.end();
					return;
				} catch (error) {
					appendAssistantMessageDiagnostic(
						output,
						createAssistantMessageDiagnostic("provider_transport_failure", error, {
							configuredTransport: transport,
							fallbackTransport: websocketStarted ? undefined : "sse",
							eventsEmitted: websocketStarted,
							phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
							requestBytes: new TextEncoder().encode(bodyJson).byteLength,
						}),
					);
					if (transport === "websocket" || transport === "websocket-cached" || websocketStarted) {
						throw error;
					}
				}
			}

			let response: Response | undefined;
			let lastError: Error | undefined;

			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				if (effectiveOptions?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				try {
					const headerTimeout = createSSEHeaderTimeout();
					const combinedSignal = combineAbortSignals([effectiveOptions?.signal, headerTimeout.signal]);
					try {
						response = await fetch(resolveCodexUrl(model.baseUrl), {
							method: "POST",
							headers: sseHeaders,
							body: bodyJson,
							signal: combinedSignal.signal,
						});
					} catch (error) {
						const timeoutError = headerTimeout.error();
						throw timeoutError && !effectiveOptions?.signal?.aborted ? new NonRetryableProviderError(timeoutError.message) : error;
					} finally {
						combinedSignal.cleanup();
						headerTimeout.clear();
					}

					await effectiveOptions?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);

					if (response.ok) {
						break;
					}

					const errorText = await response.text();
					if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
						await sleep(BASE_DELAY_MS * 2 ** attempt, effectiveOptions?.signal);
						continue;
					}

					const fakeResponse = new Response(errorText, {
						status: response.status,
						statusText: response.statusText,
					});
					const info = await parseErrorResponse(fakeResponse);
					throw new NonRetryableProviderError(info.friendlyMessage || info.message);
				} catch (error) {
					if (error instanceof NonRetryableProviderError) {
						throw error;
					}
					if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
						throw new Error("Request was aborted");
					}

					lastError = error instanceof Error ? error : new Error(String(error));
					if (attempt < MAX_RETRIES && !lastError.message.includes("usage limit")) {
						await sleep(BASE_DELAY_MS * 2 ** attempt, effectiveOptions?.signal);
						continue;
					}
					throw lastError;
				}
			}

			if (!response?.ok) {
				throw lastError ?? new Error("Failed after retries");
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			stream.push({ type: "start", partial: output });
			await processCapturedResponsesStream(parseSSE(response, effectiveOptions?.signal), output, stream, model, effectiveOptions, deps, requestCwd, requestPrompt);
			finalizeUsage(model, output);

			if (effectiveOptions?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			stream.push({
				type: "error",
				reason: (effectiveOptions?.signal?.aborted ? "aborted" : "error") as "aborted" | "error",
				error: createErrorMessage(output, error, !!effectiveOptions?.signal?.aborted),
			});
			stream.end();
		} finally {
			deps.onStreamSettled?.();
		}
	})();

	return stream;
}

export function registerOpenAICodexCustomProvider(pi: ExtensionAPI, options: { getCurrentCwd: () => string; getConfig?: () => Pick<CodexConversionConfig, "forceCachedWebSockets"> | undefined; getNativeToolRewriteConfig?: () => { webSearch: boolean; imageGeneration: boolean } | undefined }): void {
	const activityDispatcher = createActivityMessageDispatcher(pi.sendMessage.bind(pi));

	const clearPendingMessages = () => {
		activityDispatcher.clear();
	};

	pi.registerProvider("openai-codex", {
		api: "openai-codex-responses",
		streamSimple: (model, context, streamOptions) => {
			const turnActivities: PendingActivity[] = [];
			return createCodexStream(model, context, streamOptions, {
				getCurrentCwd: options.getCurrentCwd,
				...(options.getConfig ? { getConfig: options.getConfig } : {}),
				...(options.getNativeToolRewriteConfig ? { getNativeToolRewriteConfig: options.getNativeToolRewriteConfig } : {}),
				onImageSaved: (savedImage, imageData) => {
					turnActivities.push({ kind: "image", savedImage, imageData });
				},
				onWebSearchCaptured: (search) => {
					turnActivities.push({ kind: "web-search", search });
				},
				onStreamSettled: () => {
					const activities = turnActivities.splice(0, turnActivities.length);
					if (activities.length > 0) activityDispatcher.enqueueSettledActivities(activities);
				},
			});
		},
	});

	pi.on("session_start", async () => {
		clearPendingMessages();
	});

	pi.on("session_shutdown", async () => {
		activityDispatcher.flushNow();
		clearPendingMessages();
		closeOpenAICodexWebSocketSessions();
	});

	pi.on("agent_end", async () => {
		activityDispatcher.scheduleFlush();
	});

	pi.registerMessageRenderer<ImageDisplayMessageDetails>(IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, (message, options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("[image_generation]")), 0, 0));
		const savedImage = message.details?.savedImages?.[0];
		const textContent = savedImage
			? buildGeneratedImageDisplayText(savedImage, { expanded: options.expanded })
			: typeof message.content === "string"
				? message.content
				: message.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n");
		box.addChild(new Text(`\n${theme.fg("customMessageText", textContent)}`, 0, 0));
		if (savedImage) {
			const preview = loadCachedImagePreview(savedImage, activityDispatcher.imagePreviewCache);
			if (preview) {
				box.addChild(new Spacer(1));
				box.addChild(
					new Image(preview.data, preview.mimeType, { fallbackColor: (text) => theme.fg("customMessageText", text) }, { maxWidthCells: 60 }),
				);
			}
		}
		return box;
	});

	pi.registerMessageRenderer<{ searches?: SurfacedWebSearch[] | undefined }>(WEB_SEARCH_ACTIVITY_MESSAGE_TYPE, (message, options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		const searches = message.details?.searches ?? [];
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(buildWebSearchSummaryText(searches))), 0, 0));
		if (options.expanded) {
			const content = typeof message.content === "string"
				? message.content
				: message.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n");
			box.addChild(new Text(`\n${theme.fg("customMessageText", content)}`, 0, 0));
		}
		return box;
	});
}
