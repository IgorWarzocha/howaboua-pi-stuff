import { normalizePipeOutput, truncateOutput, truncateToTail } from "./output.ts";
import { createBridgeSessionRuntime, type BridgeExecSession, type BridgeSessionHooks } from "./bridge-session.ts";
import { DEFAULT_EXEC_YIELD_TIME_MS, DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS, DEFAULT_WRITE_YIELD_TIME_MS, clampExecYieldTime, clampWriteYieldTime, normalizeMinEmptyWriteYieldTime, normalizeMinNonInteractiveExecYieldTime, resolveExecution, resolveShell, resolveWorkdir } from "./shell.ts";
import { registerAbortHandler, waitForExitOrInactivity } from "./wait.ts";
import { makeExecResult, makeSnapshotResult, makeSnapshotSince, snapshotSession } from "./results.ts";

export interface UnifiedExecResult {
	chunk_id: string;
	wall_time_seconds: number;
	output: string;
	exit_code?: number | undefined;
	session_id?: number | undefined;
	original_token_count?: number | undefined;
}

export interface ExecSessionSnapshot {
	id: number;
	command: string;
	running: boolean;
	exitCode?: number | undefined;
	startedAt: number;
	updatedAt: number;
	outputTail: string;
	terminating: boolean;
}

export type ExecSessionChangeReason = "start" | "output" | "exit" | "terminate";

export interface ExecCommandInput {
	cmd: string;
	workdir?: string | undefined;
	shell?: string | undefined;
	env?: NodeJS.ProcessEnv | undefined;
	tty?: boolean | undefined;
	yield_time_ms?: number | undefined;
	max_yield_time_ms?: number | undefined;
	max_output_tokens?: number | undefined;
	login?: boolean | undefined;
}

export interface WriteStdinInput {
	session_id: number;
	chars?: string | undefined;
	yield_time_ms?: number | undefined;
	max_output_tokens?: number | undefined;
}

type ExecSession = BridgeExecSession;

export type ExecSessionUpdateCallback = (result: UnifiedExecResult) => void;

export interface ExecSessionManager {
	setBaseEnv(env: NodeJS.ProcessEnv): void;
	exec(input: ExecCommandInput, cwd: string, signal?: AbortSignal, onUpdate?: ExecSessionUpdateCallback): Promise<UnifiedExecResult>;
	write(input: WriteStdinInput, signal?: AbortSignal, onUpdate?: ExecSessionUpdateCallback): Promise<UnifiedExecResult>;
	hasSession(sessionId: number): boolean;
	getSessionCommand(sessionId: number): string | undefined;
	listSessions(maxOutputChars?: number): ExecSessionSnapshot[];
	terminateSession(sessionId: number): boolean;
	onSessionChange(listener: (reason: ExecSessionChangeReason) => void): () => void;
	onSessionExit(listener: (sessionId: number, command: string) => void): () => void;
	shutdown(): void;
}

export interface ExecSessionManagerOptions {
	env?: NodeJS.ProcessEnv | undefined;
	bridgeBinaryPath?: (() => string | undefined) | undefined;
	defaultExecYieldTimeMs?: number | undefined;
	defaultWriteYieldTimeMs?: number | undefined;
	minNonInteractiveExecYieldTimeMs?: number | undefined;
	minEmptyWriteYieldTimeMs?: number | undefined;
	maxEmptyWriteYieldTimeMs?: number | undefined;
	maxSessionBufferChars?: number | undefined;
}

const MAX_COMMAND_HISTORY = 256;
const MAX_COMPLETED_SESSION_HISTORY = 32;
const MAX_COMPLETED_SESSION_OUTPUT_CHARS = 64 * 1024;
const MAX_COMPLETED_SESSION_OUTPUT_TOKENS = MAX_COMPLETED_SESSION_OUTPUT_CHARS / 4;
const DEFAULT_MAX_TTY_SESSION_BUFFER_CHARS = 1024 * 1024;
const DEFAULT_MAX_PIPE_SESSION_BUFFER_CHARS = 256 * 1024 * 1024;
const TERMINATE_ESCALATE_MS = 2_000;

export function createExecSessionManager(options: ExecSessionManagerOptions = {}): ExecSessionManager {
	let nextSessionId = 1;
	const sessions = new Map<number, ExecSession>();
	const commandHistory = new Map<number, string>();
	const completedResults = new Map<number, UnifiedExecResult>();
	const changeListeners = new Set<(reason: ExecSessionChangeReason) => void>();
	const exitListeners = new Set<(sessionId: number, command: string) => void>();
	const bridgeSessions = createBridgeSessionRuntime(options.bridgeBinaryPath);
	let baseEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
	const defaultExecYieldTimeMs = options.defaultExecYieldTimeMs ?? DEFAULT_EXEC_YIELD_TIME_MS;
	const defaultWriteYieldTimeMs = options.defaultWriteYieldTimeMs ?? DEFAULT_WRITE_YIELD_TIME_MS;
	const minNonInteractiveExecYieldTimeMs = normalizeMinNonInteractiveExecYieldTime(options.minNonInteractiveExecYieldTimeMs);
	const minEmptyWriteYieldTimeMs = normalizeMinEmptyWriteYieldTime(options.minEmptyWriteYieldTimeMs);
	const maxEmptyWriteYieldTimeMs = Math.max(
		minEmptyWriteYieldTimeMs,
		options.maxEmptyWriteYieldTimeMs ?? DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS,
	);
	const configuredMaxSessionBufferChars = options.maxSessionBufferChars === undefined ? undefined : Math.max(1024, options.maxSessionBufferChars);

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

	function rememberCompletedResult(sessionId: number, result: UnifiedExecResult): void {
		const bounded = truncateToTail(result.output, MAX_COMPLETED_SESSION_OUTPUT_CHARS);
		completedResults.set(sessionId, {
			...result,
			output: bounded.removed > 0 ? `[Earlier completed output omitted]\n${bounded.output}` : bounded.output,
		});
		if (completedResults.size <= MAX_COMPLETED_SESSION_HISTORY) return;
		const oldest = completedResults.keys().next().value;
		if (oldest !== undefined) completedResults.delete(oldest);
	}

	function replayCompletedResult(result: UnifiedExecResult, maxOutputTokens?: number): UnifiedExecResult {
		const originalCharCount = result.original_token_count === undefined
			? result.output.length
			: result.original_token_count * 4;
		return { ...result, ...truncateOutput(result.output, maxOutputTokens, originalCharCount) };
	}

	function finishResult(session: ExecSession, waitMs: number, maxOutputTokens?: number): UnifiedExecResult {
		const completed = session.exitCode !== undefined && session.exitCode !== null;
		const replaySnapshot = completed ? makeSnapshotResult(session, waitMs, MAX_COMPLETED_SESSION_OUTPUT_TOKENS, true) : undefined;
		const result = makeExecResult(session, waitMs, maxOutputTokens, exposeSession, (sessionId) => sessions.delete(sessionId));
		if (!replaySnapshot || sessions.has(session.id)) return result;
		rememberCompletedResult(session.id, { ...replaySnapshot, chunk_id: result.chunk_id, wall_time_seconds: result.wall_time_seconds });
		return result;
	}

	function notify(session: ExecSession, reason: ExecSessionChangeReason = "output"): void {
		session.updatedAt = Date.now();
		for (const listener of session.listeners) {
			listener();
		}
		if (session.exposed) notifyChanged(reason);
	}

	function notifyChanged(reason: ExecSessionChangeReason): void {
		for (const listener of changeListeners) {
			listener(reason);
		}
	}

	function finalizeSession(session: ExecSession, reason: ExecSessionChangeReason = "exit"): void {
		if (session.finalized) return;
		session.finalized = true;
		for (const listener of exitListeners) {
			listener(session.id, session.command);
		}
		notify(session, reason);
	}

	function exposeSession(session: ExecSession): void {
		if (session.exposed || (session.exitCode !== undefined && session.exitCode !== null)) return;
		session.exposed = true;
		notifyChanged("start");
	}

	function appendOutput(session: ExecSession, text: string): void {
		if (text.length === 0) return;
		const output = session.tty ? text : normalizePipeOutput(text);
		session.buffer += output;
		session.outputVersion += 1;
		const maxSessionBufferChars = configuredMaxSessionBufferChars ?? (session.tty ? DEFAULT_MAX_TTY_SESSION_BUFFER_CHARS : DEFAULT_MAX_PIPE_SESSION_BUFFER_CHARS);
		if (session.buffer.length > maxSessionBufferChars) {
			const bounded = truncateToTail(session.buffer, maxSessionBufferChars);
			session.buffer = bounded.output;
			session.bufferStartOffset += bounded.removed;
		}
		notify(session);
	}

	function setBaseEnv(env: NodeJS.ProcessEnv): void {
		baseEnv = { ...env };
	}

	const bridgeHooks: BridgeSessionHooks = {
		isOwned: (session) => sessions.get(session.id) === session,
		onOutput: (session, text) => appendOutput(session, text),
		onExit: (session) => finalizeSession(session),
	};

	return {
		setBaseEnv,
		exec: async (input, cwd, signal, onUpdate) => {
			const shell = resolveShell(input.shell);
			const workdir = resolveWorkdir(cwd, input.workdir);
			const execution = resolveExecution(input.shell, input.cmd, input.env, baseEnv);
			const session = bridgeSessions.create({
				id: nextSessionId++,
				input: {
					command: input.cmd,
					executionCommand: execution.command,
					executionEnv: execution.env,
					...(input.tty === undefined ? {} : { tty: input.tty }),
					...(input.login === undefined ? {} : { login: input.login }),
				},
				workdir,
				shell,
				...(signal ? { signal } : {}),
				hooks: bridgeHooks,
			});
			sessions.set(session.id, session);
			rememberCommand(session.id, session.command);
			const abortCleanup = registerAbortHandler(signal, () => {
				if (session.exitCode === undefined || session.exitCode === null) {
					void bridgeSessions.terminate(session).catch(() => {});
				}
			});

			try {
				onUpdate?.(makeSnapshotResult(session, 0, input.max_output_tokens, true));
				const execYieldMs = clampExecYieldTime(input.yield_time_ms, defaultExecYieldTimeMs, session.interactive, minNonInteractiveExecYieldTimeMs, input.max_yield_time_ms);
				const maxExecWaitMs = Math.max(execYieldMs, input.max_yield_time_ms ?? execYieldMs);
				const waitedMs = await waitForExitOrInactivity(
					session,
					execYieldMs,
					maxExecWaitMs,
					signal,
					onUpdate ? (elapsedMs) => onUpdate(makeSnapshotResult(session, elapsedMs, input.max_output_tokens)) : undefined,
				);
				await bridgeSessions.waitForStartup(session, signal);
				if (session.started) await bridgeSessions.poll(session, bridgeHooks, 0);
				if (session.exitCode === undefined || session.exitCode === null)
					session.nextEmptyPollYieldMs = growEmptyPollYield(Math.max(execYieldMs, waitedMs), maxEmptyWriteYieldTimeMs);
				return finishResult(session, waitedMs, input.max_output_tokens);
			} catch (error) {
				if (signal?.aborted) sessions.delete(session.id);
				throw error;
			} finally {
				abortCleanup();
			}
		},
		write: async (input, signal, onUpdate) => {
			if (signal?.aborted) {
				throw new Error("write_stdin aborted");
			}
			const session = sessions.get(input.session_id);
			if (!session) {
				const completed = completedResults.get(input.session_id);
				if (completed) {
					if ((input.chars ?? "").length > 0) {
						throw new Error(`Process id ${input.session_id} already exited with code ${completed.exit_code}; cannot write stdin`);
					}
					return replayCompletedResult(completed, input.max_output_tokens);
				}
				throw new Error(`Unknown process id ${input.session_id}`);
			}
			const updateBaseline = session.bufferStartOffset + session.buffer.length;
			const chars = input.chars ?? "";
			const isEmptyPoll = chars.length === 0;
			if (!isEmptyPoll) {
				if (!session.interactive) {
					throw new Error("stdin is closed for this session; rerun exec_command with tty=true to keep stdin open");
				}
				await bridgeSessions.write(session, chars);
				session.nextEmptyPollYieldMs = undefined;
			}
			onUpdate?.(makeSnapshotSince(session, 0, updateBaseline, input.max_output_tokens));
			const requestedYieldMs = clampWriteYieldTime(
				input.yield_time_ms,
				defaultWriteYieldTimeMs,
				isEmptyPoll,
				minEmptyWriteYieldTimeMs,
				maxEmptyWriteYieldTimeMs,
			);
			const effectiveYieldMs = isEmptyPoll
				? Math.max(requestedYieldMs, session.nextEmptyPollYieldMs ?? 0)
				: requestedYieldMs;
			const waitedMs =
				session.exitCode === undefined
					? await waitForExitOrInactivity(
							session,
							effectiveYieldMs,
							effectiveYieldMs,
							signal,
							onUpdate ? (elapsedMs) => onUpdate(makeSnapshotSince(session, elapsedMs, updateBaseline, input.max_output_tokens)) : undefined,
						)
					: 0;
			await bridgeSessions.waitForStartup(session, signal);
			if (session.started) await bridgeSessions.poll(session, bridgeHooks, 0);
			if (isEmptyPoll && (session.exitCode === undefined || session.exitCode === null))
				session.nextEmptyPollYieldMs = growEmptyPollYield(effectiveYieldMs, maxEmptyWriteYieldTimeMs);
			return finishResult(session, waitedMs, input.max_output_tokens);
		},
		hasSession: (sessionId) => sessions.has(sessionId),
		getSessionCommand: (sessionId) => sessions.get(sessionId)?.command ?? commandHistory.get(sessionId),
		listSessions: (maxOutputChars) => {
			const snapshotsById = new Map<number, ExecSessionSnapshot>();
			for (const session of sessions.values()) {
				if (!session.exposed) continue;
				if (session.exitCode !== undefined && session.exitCode !== null) continue;
				snapshotsById.set(session.id, snapshotSession(session, maxOutputChars));
			}
			return Array.from(snapshotsById.values()).sort((a, b) => a.id - b.id);
		},
		terminateSession: (sessionId) => {
			const session = sessions.get(sessionId);
			if (!session || session.exitCode !== undefined || session.terminating) return false;
			session.terminating = true;
			void bridgeSessions.terminate(session).catch(() => {});
			setTimeout(() => {
				if (session.exitCode === undefined || session.exitCode === null) void bridgeSessions.terminate(session).catch(() => {});
			}, TERMINATE_ESCALATE_MS).unref?.();
			notify(session, "terminate");
			return true;
		},
		onSessionChange: (listener) => {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
		onSessionExit: (listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		shutdown: () => {
			for (const session of sessions.values()) {
				if (session.exitCode === undefined || session.exitCode === null) void bridgeSessions.terminate(session).catch(() => {});
			}
			bridgeSessions.shutdown();
			sessions.clear();
			commandHistory.clear();
			completedResults.clear();
		},
	};
}

function growEmptyPollYield(currentMs: number, maximumMs: number): number {
	return Math.min(maximumMs, currentMs * 2);
}
