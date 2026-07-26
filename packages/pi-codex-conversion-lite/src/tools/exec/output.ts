import { randomBytes } from "node:crypto";
import type { UnifiedExecResult } from "./session-manager.ts";

const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

export interface ExecOutputSessionState {
	buffer: string;
	bufferStartOffset: number;
	emittedOffset: number;
}

function maxCharsForTokens(maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): number {
	return Math.max(256, maxOutputTokens * 4);
}

function stripTerminalControlSequences(text: string): string {
	const withoutOscAndDcs = text
		.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
		.replace(/\u001B[P_X^][\s\S]*?\u001B\\/g, "");
	return withoutOscAndDcs.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001B[@-_]/g, "");
}

function sanitizeBinaryOutput(text: string): string {
	return Array.from(text).filter((char) => {
		const code = char.codePointAt(0);
		if (code === undefined) return false;
		if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
		if (code <= 0x1f) return false;
		if (code >= 0xfff9 && code <= 0xfffb) return false;
		return true;
	}).join("");
}

export function normalizePipeOutput(text: string): string {
	return sanitizeBinaryOutput(stripTerminalControlSequences(text)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function truncateToTail(text: string, maxChars: number): { output: string; removed: number } {
	let start = Math.max(0, text.length - maxChars);
	if (start > 0 && start < text.length && /[\uDC00-\uDFFF]/.test(text[start]!)) start += 1;
	return { output: text.slice(start), removed: start };
}

export function generateChunkId(): string {
	return randomBytes(3).toString("hex");
}

export function truncateOutput(text: string, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	if (text.length === 0) return { output: "" };
	const maxChars = maxCharsForTokens(maxOutputTokens);
	const originalTokenCount = Math.ceil(text.length / 4);
	if (text.length <= maxChars) return { output: text, original_token_count: originalTokenCount };
	return { output: truncateToTail(text, maxChars).output, original_token_count: originalTokenCount };
}

export function consumeOutput(session: ExecOutputSessionState, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const endOffset = session.bufferStartOffset + session.buffer.length;
	const startOffset = Math.max(session.emittedOffset, session.bufferStartOffset);
	const text = session.buffer.slice(startOffset - session.bufferStartOffset);
	session.emittedOffset = endOffset;
	return truncateOutput(text, maxOutputTokens);
}

export function peekUnconsumedOutput(session: ExecOutputSessionState, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const startOffset = Math.max(session.emittedOffset, session.bufferStartOffset);
	const text = session.buffer.slice(startOffset - session.bufferStartOffset);
	return truncateOutput(text, maxOutputTokens);
}

export function peekOutputSince(session: ExecOutputSessionState, baselineOffset: number, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const startOffset = Math.max(baselineOffset, session.bufferStartOffset);
	const text = session.buffer.slice(startOffset - session.bufferStartOffset);
	return truncateOutput(text, maxOutputTokens);
}

export function resultFromSnapshot(args: {
	sessionId: number;
	waitMs: number;
	exitCode?: number | null | undefined;
	snapshot: { output: string; original_token_count?: number | undefined };
}): UnifiedExecResult {
	const result: UnifiedExecResult = { chunk_id: generateChunkId(), wall_time_seconds: args.waitMs / 1000, output: args.snapshot.output };
	if (args.snapshot.original_token_count !== undefined) result.original_token_count = args.snapshot.original_token_count;
	if (args.exitCode === undefined || args.exitCode === null) result.session_id = args.sessionId;
	else result.exit_code = args.exitCode;
	return result;
}
