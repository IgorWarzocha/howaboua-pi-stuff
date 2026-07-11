import { getCodexShellArgs } from "../../adapter/prompt/runtime-shell.js";
import { applyTerminalOutput, normalizePipeOutput } from "./output.js";
import { chunkToText, createExecBridgeClient } from "./bridge-client.js";
import { DEFAULT_EXEC_YIELD_TIME_MS, DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS, DEFAULT_WRITE_YIELD_TIME_MS, clampExecYieldTime, clampWriteYieldTime, normalizeMinEmptyWriteYieldTime, normalizeMinNonInteractiveExecYieldTime, resolveExecution, resolveShell, resolveWorkdir } from "./shell.js";
import { registerAbortHandler, waitForExitOrTimeout } from "./wait.js";
import { makeExecResult, makeSnapshotResult, makeSnapshotSince, snapshotSession } from "./results.js";
const MAX_COMMAND_HISTORY = 256;
const DEFAULT_MAX_SESSION_BUFFER_CHARS = 256 * 1024 * 1024;
const TERMINATE_ESCALATE_MS = 2_000;
export function createExecSessionManager(options = {}) {
    let nextSessionId = 1;
    const sessions = new Map();
    const commandHistory = new Map();
    const changeListeners = new Set();
    const exitListeners = new Set();
    const bridge = createExecBridgeClient();
    let baseEnv = { ...(options.env ?? process.env) };
    const defaultExecYieldTimeMs = options.defaultExecYieldTimeMs ?? DEFAULT_EXEC_YIELD_TIME_MS;
    const defaultWriteYieldTimeMs = options.defaultWriteYieldTimeMs ?? DEFAULT_WRITE_YIELD_TIME_MS;
    const minNonInteractiveExecYieldTimeMs = normalizeMinNonInteractiveExecYieldTime(options.minNonInteractiveExecYieldTimeMs);
    const minEmptyWriteYieldTimeMs = normalizeMinEmptyWriteYieldTime(options.minEmptyWriteYieldTimeMs);
    const maxEmptyWriteYieldTimeMs = Math.max(minEmptyWriteYieldTimeMs, options.maxEmptyWriteYieldTimeMs ?? DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS);
    const maxSessionBufferChars = Math.max(1024, options.maxSessionBufferChars ?? DEFAULT_MAX_SESSION_BUFFER_CHARS);
    function rememberCommand(sessionId, command) {
        commandHistory.set(sessionId, command);
        if (commandHistory.size <= MAX_COMMAND_HISTORY) {
            return;
        }
        const oldest = commandHistory.keys().next().value;
        if (oldest !== undefined) {
            commandHistory.delete(oldest);
        }
    }
    function notify(session, reason = "output") {
        session.updatedAt = Date.now();
        for (const listener of session.listeners) {
            listener();
        }
        if (session.exposed)
            notifyChanged(reason);
    }
    function notifyChanged(reason) {
        for (const listener of changeListeners) {
            listener(reason);
        }
    }
    function finalizeSession(session, reason = "exit") {
        if (session.finalized)
            return;
        session.finalized = true;
        for (const listener of exitListeners) {
            listener(session.id, session.command);
        }
        notify(session, reason);
    }
    function exposeSession(session) {
        if (session.exposed || (session.exitCode !== undefined && session.exitCode !== null))
            return;
        session.exposed = true;
        notifyChanged("start");
    }
    function setClosedExitCode(session, code, signal) {
        if (session.exitCode !== undefined && session.exitCode !== null)
            return;
        if (session.terminating) {
            session.exitCode = code && code !== 0 ? code : signal ? 128 + signalNumber(signal) : 143;
            return;
        }
        session.exitCode = code ?? (signal ? 128 + signalNumber(signal) : 1);
    }
    function signalNumber(signal) {
        if (signal === "SIGTERM")
            return 15;
        if (signal === "SIGKILL")
            return 9;
        if (signal === "SIGINT")
            return 2;
        const numericSignal = /^SIG(\d+)$/.exec(signal)?.[1];
        if (numericSignal)
            return Number.parseInt(numericSignal, 10);
        return 1;
    }
    function appendOutput(session, text) {
        if (text.length === 0)
            return;
        session.buffer =
            session.tty ? applyTerminalOutput(session, text) : `${session.buffer}${normalizePipeOutput(text)}`;
        if (session.buffer.length > maxSessionBufferChars) {
            session.buffer = session.buffer.slice(-maxSessionBufferChars);
            session.emittedBuffer = "";
        }
        notify(session);
    }
    function setBaseEnv(env) {
        baseEnv = { ...env };
    }
    async function pollSession(session, waitMs = 0, maxBytes) {
        const response = await bridge.request({
            op: "read",
            process_id: session.processId,
            after_seq: session.lastSeq,
            max_bytes: maxBytes,
            wait_ms: waitMs,
        });
        for (const chunk of response.chunks ?? []) {
            appendOutput(session, chunkToText(chunk.chunk));
            session.lastSeq = Math.max(session.lastSeq, chunk.seq);
        }
        session.lastSeq = Math.max(session.lastSeq, response.nextSeq - 1);
        if (typeof response.exitCode === "number") {
            setClosedExitCode(session, response.exitCode);
        }
        if (response.closed || response.exited) {
            finalizeSession(session);
        }
    }
    function createRustSession(input, workdir, shell) {
        const session = {
            kind: "rust",
            id: nextSessionId++,
            processId: "",
            command: input.cmd,
            buffer: "",
            emittedBuffer: "",
            exitCode: undefined,
            listeners: new Set(),
            interactive: Boolean(input.tty),
            tty: Boolean(input.tty),
            lastSeq: 0,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            finalized: false,
            exposed: false,
            terminating: false,
            terminalCommitted: "",
            terminalLine: [],
            terminalCursor: 0,
        };
        session.processId = `pi-${session.id}`;
        void (async () => {
            try {
                const login = input.login ?? true;
                const execution = resolveExecution(input.shell, input.cmd, input.env, baseEnv);
                const shellArgs = getCodexShellArgs(shell, execution.command, login);
                await bridge.request({
                    op: "exec",
                    process_id: session.processId,
                    argv: [shell, ...shellArgs],
                    cwd: workdir,
                    env: execution.env,
                    tty: Boolean(input.tty),
                    pipe_stdin: Boolean(input.tty),
                    arg0: null,
                });
                void pollSessionLoop(session);
            }
            catch (error) {
                appendOutput(session, `${error instanceof Error ? error.message : String(error)}\n`);
                session.exitCode = 1;
                finalizeSession(session);
            }
        })();
        return session;
    }
    async function pollSessionLoop(session) {
        while (sessions.has(session.id) && (session.exitCode === undefined || session.exitCode === null)) {
            try {
                await pollSession(session, 250);
            }
            catch (error) {
                appendOutput(session, `${error instanceof Error ? error.message : String(error)}\n`);
                session.exitCode = 1;
                finalizeSession(session);
                return;
            }
        }
    }
    return {
        setBaseEnv,
        exec: async (input, cwd, signal, onUpdate) => {
            const shell = resolveShell(input.shell);
            const workdir = resolveWorkdir(cwd, input.workdir);
            const session = createRustSession(input, workdir, shell);
            sessions.set(session.id, session);
            rememberCommand(session.id, session.command);
            const abortCleanup = registerAbortHandler(signal, () => {
                if (session.exitCode === undefined || session.exitCode === null) {
                    void bridge.request({ op: "terminate", process_id: session.processId }).catch(() => { });
                }
            });
            try {
                onUpdate?.(makeSnapshotResult(session, 0, input.max_output_tokens, true));
                const waitedMs = await waitForExitOrTimeout(session, clampExecYieldTime(input.yield_time_ms, defaultExecYieldTimeMs, session.interactive, minNonInteractiveExecYieldTimeMs, input.max_yield_time_ms), signal, onUpdate ? (elapsedMs) => onUpdate(makeSnapshotResult(session, elapsedMs, input.max_output_tokens)) : undefined);
                await pollSession(session, 0);
                return makeExecResult(session, waitedMs, input.max_output_tokens, exposeSession, (sessionId) => sessions.delete(sessionId));
            }
            finally {
                abortCleanup();
            }
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
                await bridge.request({ op: "write", process_id: session.processId, chunk: Array.from(Buffer.from(input.chars, "utf8")) });
            }
            onUpdate?.(makeSnapshotSince(session, 0, updateBaseline, input.max_output_tokens));
            const waitedMs = session.exitCode === undefined
                ? await waitForExitOrTimeout(session, clampWriteYieldTime(input.yield_time_ms, defaultWriteYieldTimeMs, !input.chars || input.chars.length === 0, minEmptyWriteYieldTimeMs, maxEmptyWriteYieldTimeMs), signal, onUpdate ? (elapsedMs) => onUpdate(makeSnapshotSince(session, elapsedMs, updateBaseline, input.max_output_tokens)) : undefined)
                : 0;
            await pollSession(session, 0);
            return makeExecResult(session, waitedMs, input.max_output_tokens, exposeSession, (sessionId) => sessions.delete(sessionId));
        },
        hasSession: (sessionId) => sessions.has(sessionId),
        getSessionCommand: (sessionId) => sessions.get(sessionId)?.command ?? commandHistory.get(sessionId),
        listSessions: (maxOutputChars) => {
            const snapshotsById = new Map();
            for (const session of sessions.values()) {
                if (!session.exposed)
                    continue;
                if (session.exitCode !== undefined && session.exitCode !== null)
                    continue;
                snapshotsById.set(session.id, snapshotSession(session, maxOutputChars));
            }
            return Array.from(snapshotsById.values()).sort((a, b) => a.id - b.id);
        },
        terminateSession: (sessionId) => {
            const session = sessions.get(sessionId);
            if (!session || session.exitCode !== undefined || session.terminating)
                return false;
            session.terminating = true;
            void bridge.request({ op: "terminate", process_id: session.processId }).catch(() => { });
            setTimeout(() => {
                if (session.exitCode === undefined || session.exitCode === null)
                    void bridge.request({ op: "terminate", process_id: session.processId }).catch(() => { });
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
                if (session.exitCode === undefined || session.exitCode === null)
                    void bridge.request({ op: "terminate", process_id: session.processId }).catch(() => { });
            }
            bridge.shutdown();
            sessions.clear();
            commandHistory.clear();
        },
    };
}
