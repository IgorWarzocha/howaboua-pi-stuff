import { mkdir, open } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CodexDiagnosticsEvent } from "../providers/openai-codex/types.ts";
import { CODEX_BACKEND_TIMING_KEYS } from "../providers/openai-codex/diagnostic-timing.ts";

const LOG_DIRECTORY_BASENAME = "pi-codex-logs";

export interface CodexDiagnosticsLog {
	path: string;
	record(event: CodexDiagnosticsEvent): void;
	close(): Promise<void>;
}

function safeFilenamePart(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/[\u0000-\u001f\u007f/\\:]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^[.-]+|[.-]+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 80);
}

export function codexDiagnosticsLogPath(options: {
	agentDir: string;
	sessionId: string;
	sessionFile?: string | undefined;
	sessionName?: string | undefined;
	logName?: string | undefined;
}): string {
	const sessionFileStem = options.sessionFile
		? safeFilenamePart(basename(options.sessionFile, ".jsonl"))
		: "";
	const identity = sessionFileStem || safeFilenamePart(options.sessionId) || "session";
	const name = options.logName
		? safeFilenamePart(options.logName)
		: options.sessionName ? safeFilenamePart(options.sessionName) : "";
	return join(options.agentDir, LOG_DIRECTORY_BASENAME, `${name ? `${name}--` : ""}${identity}.log`);
}

function safeText(value: string): string {
	return value
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/\b(?:sk-|sess-|eyJ)[A-Za-z0-9._-]{16,}\b/g, "[redacted]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 500);
}

function field(key: string, value: string | number | boolean | null | undefined): string | undefined {
	if (value === undefined) return undefined;
	return `${key}=${typeof value === "string" ? JSON.stringify(safeText(value)) : String(value)}`;
}

function eventFields(event: CodexDiagnosticsEvent): Array<string | undefined> {
	if (event.type === "connection") return [
		field("event", event.type), field("socket_id", event.socketId), field("phase", event.phase),
		field("initiator", event.initiator), field("cause", event.cause),
		field("close_code", event.closeCode), field("close_reason", event.closeReason),
	];
	if (event.type === "timing") return [
		field("event", event.type), field("lane", event.lane), field("transport", event.transport),
		field("attempt", event.attempt), field("outcome", event.outcome),
		field("request_elapsed_ms", event.requestElapsedMs), field("attempt_elapsed_ms", event.attemptElapsedMs),
		field("send_ms", event.sendMs), field("first_event_ms", event.firstEventMs),
		field("first_visible_text_ms", event.firstVisibleTextMs), field("completion_ms", event.completionMs),
		field("output_tokens", event.outputTokens), field("reasoning_tokens", event.reasoningTokens),
		field("output_tokens_per_second", event.outputTokensPerSecond),
		...CODEX_BACKEND_TIMING_KEYS.map(key => field(key, event.backend[key] === undefined ? "missing" : event.backend[key])),
	];
	if (event.type === "request") return [
		field("event", event.type),
		field("lane", event.lane),
		field("transport", event.transport),
		field("attempt", event.attempt),
		field("socket", event.socketReused === undefined ? undefined : event.socketReused ? "reused" : "new"),
		field("socket_age_ms", event.socketAgeMs),
		field("socket_request_ordinal", event.socketRequestOrdinal),
		field("socket_id", event.socketId),
		field("instructions_fingerprint", event.requestMetadata?.instructionsFingerprint),
		field("tools_fingerprint", event.requestMetadata?.toolsFingerprint),
		field("cache_key_fingerprint", event.requestMetadata?.cacheKeyFingerprint),
		field("routing_fingerprint", event.requestMetadata?.routingFingerprint),
		field("options_fingerprint", event.requestMetadata?.optionsFingerprint),
		field("socket_lane", event.socketLane),
		field("continuation", event.continuation),
		field("continuation_previous_item_type", event.continuationMismatch?.previousItemType),
		field("continuation_current_item_type", event.continuationMismatch?.currentItemType),
		field("continuation_input_items", event.continuationBaselineInputItems),
		field("continuation_response_items", event.continuationBaselineResponseItems),
		field("canonical_history", event.canonicalHistory),
		field("prewarm_kind", event.prewarm?.kind),
		field("keepalive_strategy", event.prewarm?.keepaliveStrategy),
		field("request_source", event.prewarm?.requestSource),
		field("previous_response_present", event.previousResponseId),
		field("full_input_items", event.fullInputItems),
		field("sent_input_items", event.sentInputItems),
		field("model", event.model),
		field("reasoning_effort", event.requestMetadata?.reasoningEffort),
		field("service_tier", event.requestMetadata?.serviceTier),
		field("access_program", event.requestMetadata?.accessProgram),
		field("responses_lite", event.requestMetadata?.responsesLite),
		field("routing_hint", event.requestMetadata?.routingHint),
		field("request_headers_sent", event.requestMetadata?.headersSent),
		field("guardian_reviewer", event.requestMetadata?.guardianReviewer),
		field("parent_thread_linked", event.requestMetadata?.parentThreadLinked),
		field("subagent_kind", event.requestMetadata?.subagentKind),
		field("compaction_source", event.compaction?.inputSource),
		field("compaction_replay", event.compaction?.canonicalReplay),
		field("checkpoint_reused", event.compaction?.checkpointReused),
		field("checkpoint_model", event.compaction?.checkpointModel),
		field("rewritten_tool_outputs", event.compaction?.rewrittenToolOutputs),
	];
	if (event.type === "usage") {
		const totalInput = event.inputTokens + event.cachedInputTokens + event.cacheWriteInputTokens;
		return [
			field("event", event.type),
			field("lane", event.lane),
			field("transport", event.transport),
			field("input_tokens", totalInput),
			field("cache_read", event.cachedInputTokens),
			field("cache_write", event.cacheWriteInputTokens),
			field("output_tokens", event.outputTokens),
		];
	}
	if (event.type === "retry") return [
		field("event", event.type), field("lane", event.lane), field("transport", event.transport),
		field("attempt", event.attempt), field("delay_ms", event.delayMs),
		field("failure", event.failure.category), field("code", event.failure.code), field("status", event.failure.status),
	];
	if (event.type === "fallback") return [
		field("event", event.type), field("lane", event.lane), field("from", event.from),
		field("to", event.to), field("reason", event.reason),
	];
	if (event.type === "failure") return [
		field("event", event.type), field("lane", event.lane), field("transport", event.transport),
		field("failure", event.failure.category), field("code", event.failure.code), field("status", event.failure.status),
	];
	if (event.type === "prewarm-ready") {
		const generatedRefresh = event.prewarm.keepaliveStrategy === "generated-current";
		const totalInput = event.usage
			? event.usage.inputTokens + event.usage.cachedInputTokens + event.usage.cacheWriteInputTokens
			: undefined;
		return [
			field("event", event.type),
			field("transport", event.transport),
			field("socket", event.socketReused ? "reused" : "new"),
			field("socket_id", event.socketId),
			field("socket_age_ms", event.socketAgeMs),
			field("socket_lane", event.socketLane),
			field("prewarm_kind", event.prewarm.kind),
			field("keepalive_strategy", event.prewarm.keepaliveStrategy),
			field("request_source", event.prewarm.requestSource),
			field("input_tokens", totalInput),
			field("cache_read", event.usage?.cachedInputTokens),
			field("cache_write", event.usage?.cacheWriteInputTokens),
			field("output_tokens", event.usage?.outputTokens),
			field("cache_usage", event.usage ? generatedRefresh ? "authoritative" : "non_authoritative" : "unavailable"),
		];
	}
	return [
		field("event", event.type),
		field("phase", event.phase),
		field("keepalive_strategy", event.strategy),
		field("interval_ms", event.intervalMs),
		field("request_source", event.requestSource),
		field("action", event.action),
	];
}

function formatEvent(event: CodexDiagnosticsEvent): string {
	return `${new Date().toISOString()} ${[field("local_request_id", event.requestId),
		field("scope", event.scope),
		field("request_counter_process_id", event.requestCounterProcessId), field("session_request_ordinal", event.sessionRequestOrdinal),
		...eventFields(event)].filter((value): value is string => value !== undefined).join(" ")}\n`;
}

export async function createCodexDiagnosticsLog(options: {
	sessionId: string;
	sessionFile?: string | undefined;
	sessionName?: string | undefined;
	logName?: string | undefined;
	cwd: string;
	modelProvider?: string | undefined;
	modelId?: string | undefined;
	agentDir: string;
	onError: (error: unknown) => void;
}): Promise<CodexDiagnosticsLog> {
	const agentDir = options.agentDir;
	const path = codexDiagnosticsLogPath({
		agentDir,
		sessionId: options.sessionId,
		sessionFile: options.sessionFile,
		sessionName: options.sessionName,
		logName: options.logName,
	});
	await mkdir(join(agentDir, LOG_DIRECTORY_BASENAME), { recursive: true, mode: 0o700 });
	const header = [
		"# Pi Codex diagnostics",
		"# Metadata only: prompts, messages, tool arguments, images, credentials, and response IDs are omitted.",
		"# session_request_ordinal: native session within this live process; response/compaction attempts only; retries/fallback share an ordinal; prewarm/keepalive excluded. Counts with logging off; resets on process restart, not compaction/window/socket reset or same-process resume. Missing without a native session ID.",
		"# socket_request_ordinal: response.create attempts on this physical socket, including labelled prewarm/keepalive; resets on socket replacement. Request ordinals count attempted sends, not successful responses.",
		`# opened=${new Date().toISOString()}`,
		`# session_id=${JSON.stringify(options.sessionId)}`,
		`# session_name=${JSON.stringify(options.sessionName ?? "")}`,
		`# log_name=${JSON.stringify(options.logName ?? "")}`,
		`# session_file=${JSON.stringify(options.sessionFile ?? "")}`,
		`# cwd=${JSON.stringify(options.cwd)}`,
		`# model=${JSON.stringify([options.modelProvider, options.modelId].filter(Boolean).join("/") || "")}`,
		"",
	].join("\n");
	const handle = await open(path, "a", 0o600);
	try {
		await handle.appendFile(header, "utf8");
	} catch (error) {
		await handle.close();
		throw error;
	}

	let failed = false;
	let closing: Promise<void> | undefined;
	let pending = Promise.resolve();
	return {
		path,
		record(event) {
			if (failed || closing) return;
			const line = formatEvent(event);
			pending = pending
				.then(() => failed ? undefined : handle.appendFile(line, "utf8"))
				.catch((error: unknown) => {
					failed = true;
					try {
						options.onError(error);
					} catch {
						// Logging failures must not escape into provider or shutdown paths.
					}
				});
		},
		close() {
			closing ??= pending.finally(() => handle.close());
			return closing;
		},
	};
}
