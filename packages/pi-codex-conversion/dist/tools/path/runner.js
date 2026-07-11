import { spawn } from "node:child_process";
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;
export function runBundledTool({ binary, args, stdin, cwd, env, maxBuffer, signal, label }) {
    return new Promise((resolve, reject) => {
        const toolLabel = label ?? "tool";
        if (signal?.aborted) {
            reject(new Error("Operation aborted"));
            return;
        }
        const outputLimit = maxBuffer ?? DEFAULT_MAX_BUFFER;
        let stdout = "";
        let stderr = "";
        let outputBytes = 0;
        let settled = false;
        const child = spawn(binary, args, {
            cwd,
            env: env ?? process.env,
            stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        });
        const cleanup = () => {
            signal?.removeEventListener("abort", onAbort);
        };
        const finish = (fn) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            fn();
        };
        const append = (target, chunk) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            outputBytes += Buffer.byteLength(text, "utf8");
            if (outputBytes > outputLimit) {
                child.kill();
                finish(() => reject(new Error(`${toolLabel} output exceeded ${outputLimit} bytes`)));
                return;
            }
            if (target === "stdout")
                stdout += text;
            else
                stderr += text;
        };
        const onAbort = () => {
            child.kill();
            finish(() => reject(new Error("Operation aborted")));
        };
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => append("stdout", chunk));
        child.stderr?.on("data", (chunk) => append("stderr", chunk));
        child.on("error", (error) => finish(() => reject(error)));
        child.on("close", (status) => finish(() => resolve({ stdout, stderr, status })));
        signal?.addEventListener("abort", onAbort, { once: true });
        if (stdin !== undefined)
            child.stdin?.end(stdin);
    });
}
export function parseSingleJsonLine(stdout, label) {
    const jsonLine = stdout
        .trimEnd()
        .split("\n")
        .findLast((line) => line.trimStart().startsWith("{"));
    if (!jsonLine)
        throw new Error(`${label} did not return structured JSON output`);
    return JSON.parse(jsonLine);
}
