import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import * as pty from "node-pty";
import { CODEX_FALLBACK_SHELL, getCodexRuntimeShell, isFishShell } from "../adapter/runtime-shell.ts";

export interface UnifiedExecResult {
	chunk_id: string;
	wall_time_seconds: number;
	output: string;
	exit_code?: number | undefined;
	session_id?: number | undefined;
	original_token_count?: number | undefined;
}

export interface ExecCommandInput {
	cmd: string;
	workdir?: string | undefined;
	shell?: string | undefined;
	tty?: boolean | undefined;
	yield_time_ms?: number | undefined;
	max_output_tokens?: number | undefined;
	login?: boolean | undefined;
}

export interface WriteStdinInput {
	session_id: number;
	chars?: string | undefined;
	yield_time_ms?: number | undefined;
	max_output_tokens?: number | undefined;
}

interface BaseExecSession {
	id: number;
	command: string;
	buffer: string;
	emittedBuffer: string;
	exitCode: number | null | undefined;
	listeners: Set<() => void>;
	interactive: boolean;
}

interface PipeExecSession extends BaseExecSession {
	kind: "pipe";
	child: ChildProcessByStdio<null, Readable, Readable>;
}

interface PtyExecSession extends BaseExecSession {
	kind: "pty";
	child: pty.IPty;
	terminalCommitted: string;
	terminalLine: string[];
	terminalCursor: number;
}

type ExecSession = PipeExecSession | PtyExecSession;

export type ExecSessionUpdateCallback = (result: UnifiedExecResult) => void;

export interface ExecSessionManager {
	exec(input: ExecCommandInput, cwd: string, signal?: AbortSignal, onUpdate?: ExecSessionUpdateCallback): Promise<UnifiedExecResult>;
	write(input: WriteStdinInput, signal?: AbortSignal, onUpdate?: ExecSessionUpdateCallback): Promise<UnifiedExecResult>;
	hasSession(sessionId: number): boolean;
	getSessionCommand(sessionId: number): string | undefined;
	onSessionExit(listener: (sessionId: number, command: string) => void): () => void;
	shutdown(): void;
}

export interface ExecSessionManagerOptions {
	defaultExecYieldTimeMs?: number | undefined;
	defaultWriteYieldTimeMs?: number | undefined;
	minNonInteractiveExecYieldTimeMs?: number | undefined;
	minEmptyWriteYieldTimeMs?: number | undefined;
	maxEmptyWriteYieldTimeMs?: number | undefined;
	maxSessionBufferChars?: number | undefined;
}

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
const DEFAULT_WRITE_YIELD_TIME_MS = 250;
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const MIN_YIELD_TIME_MS = 250;
const MIN_NON_INTERACTIVE_EXEC_YIELD_TIME_MS = 5_000;
const MIN_EMPTY_WRITE_YIELD_TIME_MS = 5_000;
const MAX_YIELD_TIME_MS = 30_000;
const DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS = 300_000;
const MAX_COMMAND_HISTORY = 256;
const DEFAULT_MAX_SESSION_BUFFER_CHARS = 256 * 1024 * 1024;

function resolveWorkdir(baseCwd: string, workdir?: string): string {
	if (!workdir) return baseCwd;
	return resolve(baseCwd, workdir);
}

function resolveShell(shell?: string): string {
	return getCodexRuntimeShell(shell || process.env["SHELL"]!);
}

const BASH_SYNC_ENV_KEYS = [
	"PATH",
	"SHELL",
	"HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"BUN_INSTALL",
	"PNPM_HOME",
	"MISE_DATA_DIR",
	"MISE_CONFIG_DIR",
	"MISE_SHIMS_DIR",
	"CARGO_HOME",
	"GOPATH",
	"ANDROID_HOME",
	"ANDROID_NDK_HOME",
	"JAVA_HOME",
];

function shellEscape(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shouldSyncBashEnv(requestedShell: string | undefined, effectiveShell: string): boolean {
	return effectiveShell === CODEX_FALLBACK_SHELL && isFishShell(requestedShell || process.env["SHELL"]!);
}

function buildSyncedBashCommand(command: string, env: NodeJS.ProcessEnv): string {
	const assignments: string[] = [];
	for (const key of BASH_SYNC_ENV_KEYS) {
		const value = key === "SHELL" ? CODEX_FALLBACK_SHELL : env[key]!;
		if (typeof value !== "string") continue;
		assignments.push(`export ${key}=${shellEscape(value)}`);
	}
	if (assignments.length === 0) return command;
	return `${assignments.join("; ")}; ${command}`;
}

function resolveExecution(requestedShell: string | undefined, command: string): { shell: string; command: string; env: NodeJS.ProcessEnv } {
	const shell = resolveShell(requestedShell);
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (!shouldSyncBashEnv(requestedShell, shell)) {
		return { shell, command, env };
	}
	env["SHELL"] = CODEX_FALLBACK_SHELL;
	return {
		shell,
		command: buildSyncedBashCommand(command, env),
		env,
	};
}

function clampYieldTime(yieldTimeMs: number | undefined, fallback: number): number {
	const value = yieldTimeMs ?? fallback;
	return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, value));
}

function clampExecYieldTime(
	yieldTimeMs: number | undefined,
	fallback: number,
	isInteractive: boolean,
	minNonInteractiveExecYieldTimeMs: number,
): number {
	const value = clampYieldTime(yieldTimeMs, fallback);
	if (isInteractive) {
		return value;
	}
	return Math.min(MAX_YIELD_TIME_MS, Math.max(minNonInteractiveExecYieldTimeMs, value));
}

function clampWriteYieldTime(
	yieldTimeMs: number | undefined,
	fallback: number,
	isEmptyPoll: boolean,
	minEmptyWriteYieldTimeMs: number,
	maxEmptyWriteYieldTimeMs: number,
): number {
	if (!isEmptyPoll) {
		return clampYieldTime(yieldTimeMs, fallback);
	}
	return Math.min(maxEmptyWriteYieldTimeMs, Math.max(minEmptyWriteYieldTimeMs, yieldTimeMs ?? fallback));
}

function maxCharsForTokens(maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): number {
	return Math.max(256, maxOutputTokens * 4);
}

function stripTerminalControlSequences(text: string, preserveCsi = false): string {
	const withoutOscAndDcs = text
		.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
		.replace(/\u001B[P_X^][\s\S]*?\u001B\\/g, "");
	if (preserveCsi) {
		return withoutOscAndDcs;
	}
	return withoutOscAndDcs.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001B[@-_]/g, "");
}

function sanitizeBinaryOutput(text: string, preserveBackspace = false): string {
	return Array.from(text)
		.filter((char) => {
			const code = char.codePointAt(0);
			if (code === undefined) return false;
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
			if (preserveBackspace && code === 0x08) return true;
			if (code <= 0x1f) return false;
			if (code >= 0xfff9 && code <= 0xfffb) return false;
			return true;
		})
		.join("");
}

function normalizePipeOutput(text: string): string {
	return sanitizeBinaryOutput(stripTerminalControlSequences(text)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function writeTerminalChar(session: PtyExecSession, char: string): void {
	if (session.terminalCursor > session.terminalLine.length) {
		session.terminalLine.push(...Array.from({ length: session.terminalCursor - session.terminalLine.length }, () => " "));
	}
	session.terminalLine[session.terminalCursor] = char;
	session.terminalCursor += 1;
}

function applyTerminalOutput(session: PtyExecSession, text: string): string {
	const sanitized = stripTerminalControlSequences(text, true);
	if (sanitized.length === 0) {
		return session.terminalCommitted + session.terminalLine.join("");
	}

	for (let index = 0; index < sanitized.length; index += 1) {
		const char = sanitized[index]!;
		if (char === "\u001b") {
			if (sanitized[index + 1] === "[") {
				let sequenceEnd = index + 2;
				while (sequenceEnd < sanitized.length) {
					const code = sanitized.charCodeAt(sequenceEnd);
					if (code >= 0x40 && code <= 0x7e) {
						break;
					}
					sequenceEnd += 1;
				}
				if (sequenceEnd >= sanitized.length) {
					break;
				}
				const params = sanitized.slice(index + 2, sequenceEnd);
				const finalByte = sanitized[sequenceEnd]!;
				if (finalByte === "K") {
					const mode = Number(params || "0");
					if (mode === 0) {
						session.terminalLine = session.terminalLine.slice(0, session.terminalCursor);
					} else if (mode === 1) {
						session.terminalLine = [
							...Array.from({ length: Math.min(session.terminalCursor, session.terminalLine.length) }, () => " "),
							...session.terminalLine.slice(session.terminalCursor),
						];
					} else if (mode === 2) {
						session.terminalLine = [];
					}
				}
				index = sequenceEnd;
				continue;
			}

			const next = (sanitized[index + 1])!;
			if (next && /[()*+,\-./]/.test(next) && index + 2 < sanitized.length) {
				index += 2;
				continue;
			}
			if (next) {
				index += 1;
			}
			continue;
		}

		const code = char.codePointAt(0);
		if (code !== undefined && code <= 0x1f && char !== "\t" && char !== "\n" && char !== "\r" && char !== "\b") {
			continue;
		}

		switch (char) {
			case "\r":
				session.terminalCursor = 0;
				break;
			case "\n":
				session.terminalCommitted += `${session.terminalLine.join("")}\n`;
				session.terminalLine = [];
				session.terminalCursor = 0;
				break;
			case "\b":
				session.terminalCursor = Math.max(0, session.terminalCursor - 1);
				break;
			default:
				writeTerminalChar(session, char);
				break;
		}
	}

	return session.terminalCommitted + session.terminalLine.join("");
}

function computePtyDelta(previous: string, current: string): string {
	if (current.startsWith(previous)) {
		return current.slice(previous.length);
	}

	const lineStart = previous.lastIndexOf("\n") + 1;
	const stablePrefix = previous.slice(0, lineStart);
	if (current.startsWith(stablePrefix)) {
		return `\r${current.slice(lineStart)}`;
	}

	return current;
}

function generateChunkId(): string {
	return randomBytes(3).toString("hex");
}

function truncateOutput(text: string, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	if (text.length === 0) {
		return { output: "" };
	}

	const maxChars = maxCharsForTokens(maxOutputTokens);
	const originalTokenCount = Math.ceil(text.length / 4);
	if (text.length <= maxChars) {
		return { output: text, original_token_count: originalTokenCount };
	}

	return {
		output: text.slice(-maxChars),
		original_token_count: originalTokenCount,
	};
}

function consumeOutput(session: ExecSession, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const text =
		session.kind === "pty" ? computePtyDelta(session.emittedBuffer, session.buffer) : session.buffer.slice(session.emittedBuffer.length);
	session.emittedBuffer = session.buffer;
	return truncateOutput(text, maxOutputTokens);
}

function peekUnconsumedOutput(session: ExecSession, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const text =
		session.kind === "pty" ? computePtyDelta(session.emittedBuffer, session.buffer) : session.buffer.slice(session.emittedBuffer.length);
	return truncateOutput(text, maxOutputTokens);
}

function peekOutputSince(session: ExecSession, baseline: string, maxOutputTokens?: number): { output: string; original_token_count?: number | undefined } {
	const text = session.kind === "pty" ? computePtyDelta(baseline, session.buffer) : session.buffer.slice(baseline.length);
	return truncateOutput(text, maxOutputTokens);
}

function registerAbortHandler(signal: AbortSignal | undefined, onAbort: () => void): () => void {
	if (!signal) {
		return () => {};
	}

	if (signal.aborted) {
		onAbort();
		return () => {};
	}

	const abortListener = () => onAbort();
	signal.addEventListener("abort", abortListener, { once: true });
	return () => signal.removeEventListener("abort", abortListener);
}

export function createExecSessionManager(options: ExecSessionManagerOptions = {}): ExecSessionManager {
	let nextSessionId = 1;
	const sessions = new Map<number, ExecSession>();
	const commandHistory = new Map<number, string>();
	const exitListeners = new Set<(sessionId: number, command: string) => void>();
	const defaultExecYieldTimeMs = options.defaultExecYieldTimeMs ?? DEFAULT_EXEC_YIELD_TIME_MS;
	const defaultWriteYieldTimeMs = options.defaultWriteYieldTimeMs ?? DEFAULT_WRITE_YIELD_TIME_MS;
	const minNonInteractiveExecYieldTimeMs = Math.min(
		MAX_YIELD_TIME_MS,
		Math.max(MIN_YIELD_TIME_MS, options.minNonInteractiveExecYieldTimeMs ?? MIN_NON_INTERACTIVE_EXEC_YIELD_TIME_MS),
	);
	const minEmptyWriteYieldTimeMs = Math.min(
		MAX_YIELD_TIME_MS,
		Math.max(MIN_YIELD_TIME_MS, options.minEmptyWriteYieldTimeMs ?? MIN_EMPTY_WRITE_YIELD_TIME_MS),
	);
	const maxEmptyWriteYieldTimeMs = Math.max(
		minEmptyWriteYieldTimeMs,
		options.maxEmptyWriteYieldTimeMs ?? DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS,
	);
	const maxSessionBufferChars = Math.max(1024, options.maxSessionBufferChars ?? DEFAULT_MAX_SESSION_BUFFER_CHARS);

	function rememberCommand(sessionId: number, command: string): void {
		commandHistory.set(sessionId, command);
		if (commandHistory.size <= MAX_COMMAND_HISTORY) {
			return;
		}
		const oldest = commandHistory.keys().next().value;
		if (oldest !== undefined) {
			commandHistory.delete(oldest);
		}
	}

	function notify(session: ExecSession): void {
		for (const listener of session.listeners) {
			listener();
		}
	}

	function finalizeSession(session: ExecSession): void {
		for (const listener of exitListeners) {
			listener(session.id, session.command);
		}
		notify(session);
	}

	function appendOutput(session: ExecSession, text: string): void {
		if (text.length === 0) return;
		session.buffer =
			session.kind === "pty" ? applyTerminalOutput(session, text) : `${session.buffer}${normalizePipeOutput(text)}`;
		if (session.buffer.length > maxSessionBufferChars) {
			session.buffer = session.buffer.slice(-maxSessionBufferChars);
			session.emittedBuffer = "";
		}
		notify(session);
	}

	function waitForExitOrTimeout(
		session: ExecSession,
		yieldTimeMs: number,
		signal?: AbortSignal,
		onUpdate?: (elapsedMs: number) => void,
	): Promise<number> {
		if (session.exitCode !== undefined && session.exitCode !== null) {
			return Promise.resolve(0);
		}
		if (signal?.aborted) {
			return Promise.resolve(0);
		}

		const startedAt = Date.now();
		let updateTimer: ReturnType<typeof setInterval> | undefined;
		let lastUpdateAt = 0;
		return new Promise((resolvePromise) => {
			let abortCleanup: (() => void) | undefined;
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				cleanup();
				resolvePromise(Date.now() - startedAt);
			};
			const emitUpdate = (force = false) => {
				const now = Date.now();
				if (!force && now - lastUpdateAt < 250) return;
				lastUpdateAt = now;
				onUpdate?.(now - startedAt);
			};
			const onWake = () => {
				if (session.exitCode === undefined || session.exitCode === null) {
					emitUpdate();
					return;
				}
				emitUpdate(true);
				finish();
			};
			const timeout = setTimeout(() => {
				finish();
			}, yieldTimeMs);
			abortCleanup = registerAbortHandler(signal, finish);
			if (onUpdate) {
				updateTimer = setInterval(emitUpdate, 250);
			}
			const cleanup = () => {
				clearTimeout(timeout);
				if (updateTimer) clearInterval(updateTimer);
				abortCleanup?.();
				session.listeners.delete(onWake);
			};
			session.listeners.add(onWake);
		});
	}

	function makeResult(session: ExecSession, waitMs: number, maxOutputTokens?: number): UnifiedExecResult {
		const consumed = consumeOutput(session, maxOutputTokens);
		const result: UnifiedExecResult = {
			chunk_id: generateChunkId(),
			wall_time_seconds: waitMs / 1000,
			output: consumed.output,
		};
		if (consumed.original_token_count !== undefined) {
			result.original_token_count = consumed.original_token_count;
		}
		if (session.exitCode === undefined || session.exitCode === null) {
			result.session_id = session.id;
		} else {
			result.exit_code = session.exitCode;
			if (session.emittedBuffer === session.buffer) {
				sessions.delete(session.id);
			}
		}
		return result;
	}

	function makeSnapshotResult(session: ExecSession, waitMs: number, maxOutputTokens?: number, unconsumedOnly = false): UnifiedExecResult {
		const snapshot = unconsumedOnly ? peekUnconsumedOutput(session, maxOutputTokens) : truncateOutput(session.buffer, maxOutputTokens);
		return makeSnapshotFromOutput(session, waitMs, snapshot);
	}

	function makeSnapshotSince(session: ExecSession, waitMs: number, baseline: string, maxOutputTokens?: number): UnifiedExecResult {
		return makeSnapshotFromOutput(session, waitMs, peekOutputSince(session, baseline, maxOutputTokens));
	}

	function makeSnapshotFromOutput(
		session: ExecSession,
		waitMs: number,
		snapshot: { output: string; original_token_count?: number | undefined },
	): UnifiedExecResult {
		const result: UnifiedExecResult = {
			chunk_id: generateChunkId(),
			wall_time_seconds: waitMs / 1000,
			output: snapshot.output,
		};
		if (snapshot.original_token_count !== undefined) {
			result.original_token_count = snapshot.original_token_count;
		}
		if (session.exitCode === undefined || session.exitCode === null) {
			result.session_id = session.id;
		} else {
			result.exit_code = session.exitCode;
		}
		return result;
	}

	function createPipeSession(input: ExecCommandInput, workdir: string, shell: string, signal?: AbortSignal): PipeExecSession {
		const login = input.login ?? true;
		const execution = resolveExecution(input.shell, input.cmd);
		const shellArgs = login ? ["-lc", execution.command] : ["-c", execution.command];
		const child = spawn(shell, shellArgs, {
			cwd: workdir,
			stdio: ["ignore", "pipe", "pipe"],
			env: execution.env,
		});

		const session: PipeExecSession = {
			kind: "pipe",
			id: nextSessionId++,
			command: input.cmd,
			child,
			buffer: "",
			emittedBuffer: "",
			exitCode: undefined,
			listeners: new Set(),
			interactive: false,
		};

		child.stdout.on("data", (data: Buffer) => {
			appendOutput(session, data.toString("utf8"));
		});
		child.stderr.on("data", (data: Buffer) => {
			appendOutput(session, data.toString("utf8"));
		});
		child.on("close", (code) => {
			session.exitCode = code ?? 0;
			finalizeSession(session);
		});
		child.on("error", (error) => {
			appendOutput(session, `${error.message}\n`);
			session.exitCode = 1;
			finalizeSession(session);
		});

		registerAbortHandler(signal, () => {
			if (session.exitCode === undefined) {
				child.kill("SIGTERM");
			}
		});

		return session;
	}

	function createPtySession(input: ExecCommandInput, workdir: string, shell: string, signal?: AbortSignal): PtyExecSession {
		const login = input.login ?? true;
		const execution = resolveExecution(input.shell, input.cmd);
		const shellArgs = login ? ["-lc", execution.command] : ["-c", execution.command];
		const child = pty.spawn(shell, shellArgs, {
			cwd: workdir,
			env: execution.env,
			name: process.env["TERM"] || "xterm-256color",
			cols: 80,
			rows: 24,
		});

		const session: PtyExecSession = {
			kind: "pty",
			id: nextSessionId++,
			command: input.cmd,
			child,
			buffer: "",
			emittedBuffer: "",
			exitCode: undefined,
			listeners: new Set(),
			interactive: true,
			terminalCommitted: "",
			terminalLine: [],
			terminalCursor: 0,
		};

		child.onData((data) => {
			appendOutput(session, data);
		});
		child.onExit(({ exitCode }) => {
			session.exitCode = exitCode ?? 0;
			finalizeSession(session);
		});

		registerAbortHandler(signal, () => {
			if (session.exitCode === undefined) {
				child.kill();
			}
		});

		return session;
	}

	return {
		exec: async (input, cwd, signal, onUpdate) => {
			const shell = resolveShell(input.shell);
			const workdir = resolveWorkdir(cwd, input.workdir);
			const session = input.tty
				? createPtySession(input, workdir, shell, signal)
				: createPipeSession(input, workdir, shell, signal);
			sessions.set(session.id, session);
			rememberCommand(session.id, session.command);

			onUpdate?.(makeSnapshotResult(session, 0, input.max_output_tokens, true));
			const waitedMs = await waitForExitOrTimeout(
				session,
				clampExecYieldTime(input.yield_time_ms, defaultExecYieldTimeMs, session.interactive, minNonInteractiveExecYieldTimeMs),
				undefined,
				onUpdate ? (elapsedMs) => onUpdate(makeSnapshotResult(session, elapsedMs, input.max_output_tokens)) : undefined,
			);
			return makeResult(session, waitedMs, input.max_output_tokens);
		},
		write: async (input, signal, onUpdate) => {
			if (signal?.aborted) {
				throw new Error("write_stdin aborted");
			}
			const session = sessions.get(input.session_id);
			if (!session) {
				throw new Error(`Unknown process id ${input.session_id}`);
			}
			const updateBaseline = session.buffer;
			if (input.chars && input.chars.length > 0) {
				if (!session.interactive) {
					throw new Error("stdin is closed for this session; rerun exec_command with tty=true to keep stdin open");
				}
				if (session.kind === "pty") {
					session.child.write(input.chars);
				}
			}
			onUpdate?.(makeSnapshotSince(session, 0, updateBaseline, input.max_output_tokens));
			const waitedMs =
				session.exitCode === undefined
					? await waitForExitOrTimeout(
							session,
							clampWriteYieldTime(
								input.yield_time_ms,
								defaultWriteYieldTimeMs,
								!input.chars || input.chars.length === 0,
								minEmptyWriteYieldTimeMs,
								maxEmptyWriteYieldTimeMs,
							),
							signal,
							onUpdate ? (elapsedMs) => onUpdate(makeSnapshotSince(session, elapsedMs, updateBaseline, input.max_output_tokens)) : undefined,
						)
					: 0;
			return makeResult(session, waitedMs, input.max_output_tokens);
		},
		hasSession: (sessionId) => sessions.has(sessionId),
		getSessionCommand: (sessionId) => sessions.get(sessionId)?.command ?? commandHistory.get(sessionId),
		onSessionExit: (listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		shutdown: () => {
			for (const session of sessions.values()) {
				if (session.exitCode !== undefined) {
					continue;
				}
				if (session.kind === "pty") {
					session.child.kill();
				} else {
					session.child.kill("SIGTERM");
				}
			}
			sessions.clear();
			commandHistory.clear();
		},
	};
}
