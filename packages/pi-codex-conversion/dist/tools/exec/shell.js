import { resolve } from "node:path";
import { CODEX_FALLBACK_SHELL, getCodexRuntimeShell, getDefaultCodexRuntimeShell, isFishShell } from "../../adapter/prompt/runtime-shell.js";
const MIN_YIELD_TIME_MS = 250;
const MIN_NON_INTERACTIVE_EXEC_YIELD_TIME_MS = 5_000;
const MIN_EMPTY_WRITE_YIELD_TIME_MS = 5_000;
const MAX_YIELD_TIME_MS = 30_000;
export const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
export const DEFAULT_WRITE_YIELD_TIME_MS = 250;
export const DEFAULT_MAX_EMPTY_WRITE_YIELD_TIME_MS = 300_000;
const BASH_SYNC_ENV_KEYS = [
    "PATH", "SHELL", "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "BUN_INSTALL", "PNPM_HOME",
    "MISE_DATA_DIR", "MISE_CONFIG_DIR", "MISE_SHIMS_DIR", "CARGO_HOME", "GOPATH", "PI_WEB_RUN_STATE_PATH", "PI_CODEX_MODEL", "ANDROID_HOME", "ANDROID_NDK_HOME", "JAVA_HOME",
];
export function resolveWorkdir(baseCwd, workdir) {
    return workdir ? resolve(baseCwd, workdir) : baseCwd;
}
export function resolveShell(shell) {
    return shell ? getCodexRuntimeShell(shell) : getDefaultCodexRuntimeShell();
}
function shellEscape(value) {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value))
        return value;
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function shouldSyncBashEnv(requestedShell, effectiveShell) {
    return effectiveShell === CODEX_FALLBACK_SHELL && isFishShell(requestedShell || process.env["SHELL"]);
}
function buildSyncedBashCommand(command, env) {
    const assignments = [];
    for (const key of BASH_SYNC_ENV_KEYS) {
        const value = key === "SHELL" ? CODEX_FALLBACK_SHELL : env[key];
        if (typeof value !== "string")
            continue;
        assignments.push(`export ${key}=${shellEscape(value)}`);
    }
    return assignments.length === 0 ? command : `${assignments.join("; ")}; ${command}`;
}
export function resolveExecution(requestedShell, command, extraEnv, baseEnv = process.env) {
    const shell = resolveShell(requestedShell);
    const env = { ...baseEnv, ...extraEnv };
    if (!shouldSyncBashEnv(requestedShell, shell))
        return { shell, command, env };
    env["SHELL"] = CODEX_FALLBACK_SHELL;
    return { shell, command: buildSyncedBashCommand(command, env), env };
}
function clampYieldTime(yieldTimeMs, fallback) {
    return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, yieldTimeMs ?? fallback));
}
export function normalizeMinNonInteractiveExecYieldTime(value) {
    return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, value ?? MIN_NON_INTERACTIVE_EXEC_YIELD_TIME_MS));
}
export function normalizeMinEmptyWriteYieldTime(value) {
    return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, value ?? MIN_EMPTY_WRITE_YIELD_TIME_MS));
}
export function clampExecYieldTime(yieldTimeMs, fallback, isInteractive, minNonInteractiveExecYieldTimeMs, maxYieldTimeMs = MAX_YIELD_TIME_MS) {
    const value = Math.min(maxYieldTimeMs, Math.max(MIN_YIELD_TIME_MS, yieldTimeMs ?? fallback));
    return isInteractive ? value : Math.min(maxYieldTimeMs, Math.max(minNonInteractiveExecYieldTimeMs, value));
}
export function clampWriteYieldTime(yieldTimeMs, fallback, isEmptyPoll, minEmptyWriteYieldTimeMs, maxEmptyWriteYieldTimeMs) {
    return isEmptyPoll ? Math.min(maxEmptyWriteYieldTimeMs, Math.max(minEmptyWriteYieldTimeMs, yieldTimeMs ?? fallback)) : clampYieldTime(yieldTimeMs, fallback);
}
