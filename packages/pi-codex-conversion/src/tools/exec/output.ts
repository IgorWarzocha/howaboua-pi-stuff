import { randomBytes } from "node:crypto";
import type { UnifiedExecResult } from "./session-manager.ts";

const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

export interface ExecOutputSessionState {
	buffer: string;
	emittedBuffer: string;
	tty: boolean;
	terminalCommitted: string;
	terminalLine: string[];
	terminalCursor: number;
}

function maxCharsForTokens(maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): number {
	return Math.max(256, maxOutputTokens * 4);
}

function stripTerminalControlSequences(text: string, preserveCsi = false): string {
	const withoutOscAndDcs = text
		.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
		.replace(/\u001B[P_X^][\s\S]*?\u001B\\/g, "");
	if (preserveCsi) return withoutOscAndDcs;
	return withoutOscAndDcs.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001B[@-_]/g, "");
}

function sanitizeBinaryOutput(text: string, preserveBackspace = false): string {
	return Array.from(text).filter((char) => {
		const code = char.codePointAt(0);
		if (code === undefined) return false;
		if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
		if (preserveBackspace && code === 0x08) return true;
		if (code <= 0x1f) return false;
		if (code >= 0xfff9 && code <= 0xfffb) return false;
		return true;
	}).join("");
}

export function normalizePipeOutput(text: string): string {
	return sanitizeBinaryOutput(stripTerminalControlSequences(text)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function writeTerminalChar(session: ExecOutputSessionState, char: string): void {
	if (session.terminalCursor > session.terminalLine.length) {
		session.terminalLine.push(...Array.from({ length: session.terminalCursor - session.terminalLine.length }, () => " "));
	}
	session.terminalLine[session.terminalCursor] = char;
	session.terminalCursor += 1;
}

export function applyTerminalOutput(session: ExecOutputSessionState, text: string): string {
	const sanitized = stripTerminalControlSequences(text, true);
	if (sanitized.length === 0) return session.terminalCommitted + session.terminalLine.join("");

	for (let index = 0; index < sanitized.length; index += 1) {
		const char = sanitized[index]!;
		if (char === "\u001b") {
			if (sanitized[index + 1] === "[") {
				let sequenceEnd = index + 2;
				while (sequenceEnd < sanitized.length) {
					const code = sanitized.charCodeAt(sequenceEnd);
					if (code >= 0x40 && code <= 0x7e) break;
					sequenceEnd += 1;
				}
				if (sequenceEnd >= sanitized.length) break;
				const params = sanitized.slice(index + 2, sequenceEnd);
				const finalByte = sanitized[sequenceEnd]!;
				if (finalByte === "K") {
					const mode = Number(params || "0");
					if (mode === 0) session.terminalLine = session.terminalLine.slice(0, session.terminalCursor);
					else if (mode === 1) {
						session.terminalLine = [
							...Array.from({ length: Math.min(session.terminalCursor, session.terminalLine.length) }, () => " "),
							...session.terminalLine.slice(session.terminalCursor),
						];
					} else if (mode === 2) session.terminalLine = [];
				}
				index = sequenceEnd;
				continue;
			}

			const next = sanitized[index + 1]!;
			if (next && /[()*+,\-./]/.test(next) && index + 2 < sanitized.length) {
				index += 2;
				continue;
			}
			if (next) index += 1;
			continue;
		}

		const code = char.codePointAt(0);
		if (code !== undefined && code <= 0x1f && char !== "\t" && char !== "\n" && char !== "\r" && char !== "\b") continue;

		switch (char) {
			case "\r": session.terminalCursor = 0; break;
			case "\n":
				session.terminalCommitted += `${session.terminalLine.join("")}\n`;
				session.terminalLine = [];
				session.terminalCursor = 0;
				break;
			case "\b": session.terminalCursor = Math.max(0, session.terminalCursor - 1); break;
			default: writeTerminalChar(session, char); break;
		}
	}

	return session.terminalCommitted + session.terminalLine.join("");
}

function computePtyDelta(previous: string, current: string): string {
	if (current.startsWith(previous)) return current.slice(previous.length);
	const lineStart = previous.lastIndexOf("\n") + 1;
	const stablePrefix = previous.slice(0, lineStart);
	if (current.startsWith(stablePrefix)) return `\r${current.slice(lineStart)}`;
	return current;
}

export function generateChunkId(): string {
	return randomBytes(3).toString("hex");
}

export function truncateOutput(text: string, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	if (text.length === 0) return { output: "" };
	const maxChars = maxCharsForTokens(maxOutputTokens);
	const originalTokenCount = Math.ceil(text.length / 4);
	if (text.length <= maxChars) return { output: text, original_token_count: originalTokenCount };
	return { output: text.slice(-maxChars), original_token_count: originalTokenCount };
}

export function consumeOutput(session: ExecOutputSessionState, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const text = session.tty ? computePtyDelta(session.emittedBuffer, session.buffer) : session.buffer.slice(session.emittedBuffer.length);
	session.emittedBuffer = session.buffer;
	return truncateOutput(text, maxOutputTokens);
}

export function peekUnconsumedOutput(session: ExecOutputSessionState, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const text = session.tty ? computePtyDelta(session.emittedBuffer, session.buffer) : session.buffer.slice(session.emittedBuffer.length);
	return truncateOutput(text, maxOutputTokens);
}

export function peekOutputSince(session: ExecOutputSessionState, baseline: string, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const text = session.tty ? computePtyDelta(baseline, session.buffer) : session.buffer.slice(baseline.length);
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
