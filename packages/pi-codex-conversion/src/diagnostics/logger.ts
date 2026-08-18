import { mkdir, open } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CodexDiagnosticsEvent } from "../providers/openai-codex/types.ts";

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
}): string {
	const sessionFileStem = options.sessionFile
		? safeFilenamePart(basename(options.sessionFile, ".jsonl"))
		: "";
	const identity = sessionFileStem || safeFilenamePart(options.sessionId) || "session";
	const name = options.sessionName ? safeFilenamePart(options.sessionName) : "";
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

function field(key: string, value: string | number | boolean | undefined): string | undefined {
	if (value === undefined) return undefined;
	return `${key}=${typeof value === "string" ? JSON.stringify(safeText(value)) : String(value)}`;
}

function eventFields(event: CodexDiagnosticsEvent): Array<string | undefined> {
	if (event.type === "request") return [
		field("event", event.type),
		field("lane", event.lane),
		field("transport", event.transport),
		field("attempt", event.attempt),
		field("socket", event.socketReused === undefined ? undefined : event.socketReused ? "reused" : "new"),
		field("continuation", event.continuation),
		field("canonical_history", event.canonicalHistory),
		field("previous_response_id", event.previousResponseId),
		field("full_input_items", event.fullInputItems),
		field("sent_input_items", event.sentInputItems),
		field("model", event.model),
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
	return [field("event", event.type), field("transport", event.transport), field("socket", event.socketReused ? "reused" : "new")];
}

function formatEvent(event: CodexDiagnosticsEvent): string {
	return `${new Date().toISOString()} ${eventFields(event).filter((value): value is string => value !== undefined).join(" ")}\n`;
}

export async function createCodexDiagnosticsLog(options: {
	sessionId: string;
	sessionFile?: string | undefined;
	sessionName?: string | undefined;
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
	});
	await mkdir(join(agentDir, LOG_DIRECTORY_BASENAME), { recursive: true, mode: 0o700 });
	const header = [
		"# Pi Codex cache diagnostics",
		"# Metadata only: prompts, messages, tool arguments, images, credentials, and response IDs are omitted.",
		`# opened=${new Date().toISOString()}`,
		`# session_id=${JSON.stringify(options.sessionId)}`,
		`# session_name=${JSON.stringify(options.sessionName ?? "")}`,
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
	let closed = false;
	let pending = Promise.resolve();
	return {
		path,
		record(event) {
			if (failed) return;
			pending = pending
				.then(() => handle.appendFile(formatEvent(event), "utf8"))
				.catch((error: unknown) => {
					failed = true;
					try {
						options.onError(error);
					} catch {
						// Logging failures must not escape into provider or shutdown paths.
					}
				});
		},
		async close() {
			if (closed) return;
			closed = true;
			try {
				await pending;
			} finally {
				await handle.close();
			}
		},
	};
}
