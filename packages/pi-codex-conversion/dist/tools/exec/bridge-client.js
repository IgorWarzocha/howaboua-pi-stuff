import { spawn } from "node:child_process";
import { getBundledPathToolBinaryPath } from "../path/binary.js";
const MAX_BRIDGE_STDERR_CHARS = 16_000;
const LOCAL_BUILD_GUIDANCE = "Bundled exec_bridge is incompatible with this Linux runtime. From a pi-codex-conversion Git checkout, run: bun install && bun run build:path-tool codex-exec-shim exec_bridge, then load that checkout's src/index.ts as the Pi extension.";
function appendBoundedText(current, next) {
    const combined = `${current}${next.toString("utf8")}`;
    return combined.length > MAX_BRIDGE_STDERR_CHARS ? combined.slice(-MAX_BRIDGE_STDERR_CHARS) : combined;
}
export function formatExecBridgeExitError(stderr, code, signal) {
    const detail = stderr.trim();
    const status = typeof code === "number" ? `code ${code}` : signal ? `signal ${signal}` : undefined;
    const prefix = status ? `exec_bridge exited (${status})` : "exec_bridge exited";
    const message = detail ? `${prefix}: ${detail}` : prefix;
    return withNativeBinaryGuidance(message);
}
function formatExecBridgeWriteError(error, stderr) {
    const detail = stderr.trim();
    return withNativeBinaryGuidance(detail ? `${error.message}: ${detail}` : error.message);
}
function withNativeBinaryGuidance(message) {
    if (!isLinuxNativeLoaderFailure(message))
        return message;
    return message.includes(LOCAL_BUILD_GUIDANCE) ? message : `${message}\n${LOCAL_BUILD_GUIDANCE}`;
}
function isLinuxNativeLoaderFailure(message) {
    return /GLIBC_[0-9.]+.*not found|version [`']GLIBC_[0-9.]+[`'] not found|ld-linux|libc\.so/i.test(message);
}
export function createExecBridgeClient() {
    let bridge;
    let nextBridgeRequestId = 1;
    const pendingBridgeRequests = new Map();
    let bridgeLineBuffer = "";
    let bridgeStderr = "";
    let bridgeClosing = false;
    function rejectPending(error) {
        for (const pending of pendingBridgeRequests.values())
            pending.reject(error);
        pendingBridgeRequests.clear();
    }
    function handleStdout(data) {
        bridgeLineBuffer += data.toString("utf8");
        for (;;) {
            const newline = bridgeLineBuffer.indexOf("\n");
            if (newline === -1)
                break;
            const line = bridgeLineBuffer.slice(0, newline).trim();
            bridgeLineBuffer = bridgeLineBuffer.slice(newline + 1);
            if (!line)
                continue;
            let response;
            try {
                response = JSON.parse(line);
            }
            catch {
                continue;
            }
            const pending = pendingBridgeRequests.get(response.request_id);
            if (!pending)
                continue;
            pendingBridgeRequests.delete(response.request_id);
            pending.resolve(response);
        }
    }
    function getBridge() {
        if (bridge && !bridge.killed)
            return bridge;
        const binary = getBundledPathToolBinaryPath("exec_bridge");
        if (!binary)
            throw new Error(`exec_bridge binary is not bundled for ${process.platform}-${process.arch}`);
        bridgeClosing = false;
        bridgeStderr = "";
        bridge = spawn(binary, [], { stdio: "pipe", env: process.env });
        bridge.stdout.on("data", handleStdout);
        bridge.stderr.on("data", (data) => {
            bridgeStderr = appendBoundedText(bridgeStderr, data);
        });
        bridge.stdin.on("error", (error) => {
            rejectPending(new Error(formatExecBridgeWriteError(error, bridgeStderr)));
        });
        bridge.on("close", (code, signal) => {
            rejectPending(new Error(bridgeClosing ? "exec_bridge closed" : formatExecBridgeExitError(bridgeStderr, code, signal)));
            bridge = undefined;
            bridgeStderr = "";
        });
        bridge.on("error", rejectPending);
        return bridge;
    }
    return {
        async request(request) {
            const requestId = nextBridgeRequestId++;
            const child = getBridge();
            const response = await new Promise((resolve, reject) => {
                pendingBridgeRequests.set(requestId, { resolve: resolve, reject });
                child.stdin.write(`${JSON.stringify({ ...request, request_id: requestId })}\n`, (error) => {
                    if (!error)
                        return;
                    pendingBridgeRequests.delete(requestId);
                    reject(new Error(formatExecBridgeWriteError(error, bridgeStderr)));
                });
            });
            if (!response.ok)
                throw new Error(response.error ?? "exec_bridge request failed");
            return response.result;
        },
        shutdown() {
            if (bridge && !bridge.killed) {
                bridgeClosing = true;
                bridge.kill();
            }
        },
    };
}
export function chunkToText(chunk) {
    return Buffer.from(chunk, "base64").toString("utf8");
}
