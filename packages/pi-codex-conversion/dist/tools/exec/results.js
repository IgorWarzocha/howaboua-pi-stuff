import { consumeOutput, generateChunkId, peekOutputSince, peekUnconsumedOutput, truncateOutput } from "./output.js";
function fromSnapshot(session, waitMs, snapshot) {
    const result = { chunk_id: generateChunkId(), wall_time_seconds: waitMs / 1000, output: snapshot.output };
    if (snapshot.original_token_count !== undefined)
        result.original_token_count = snapshot.original_token_count;
    if (session.exitCode === undefined || session.exitCode === null)
        result.session_id = session.id;
    else
        result.exit_code = session.exitCode;
    return result;
}
export function makeExecResult(session, waitMs, maxOutputTokens, exposeSession, deleteSessionIfDrained) {
    const consumed = consumeOutput(session, maxOutputTokens);
    const result = fromSnapshot(session, waitMs, consumed);
    if (session.exitCode === undefined || session.exitCode === null) {
        exposeSession(session);
    }
    else if (session.emittedBuffer === session.buffer) {
        deleteSessionIfDrained(session.id);
    }
    return result;
}
export function snapshotSession(session, maxOutputChars = 8_000) {
    return {
        id: session.id,
        command: session.command,
        running: session.exitCode === undefined || session.exitCode === null,
        exitCode: session.exitCode ?? undefined,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        outputTail: session.buffer.slice(-maxOutputChars),
        terminating: session.terminating,
    };
}
export function makeSnapshotResult(session, waitMs, maxOutputTokens, unconsumedOnly = false) {
    const snapshot = unconsumedOnly ? peekUnconsumedOutput(session, maxOutputTokens) : truncateOutput(session.buffer, maxOutputTokens);
    return fromSnapshot(session, waitMs, snapshot);
}
export function makeSnapshotSince(session, waitMs, baseline, maxOutputTokens) {
    return fromSnapshot(session, waitMs, peekOutputSince(session, baseline, maxOutputTokens));
}
