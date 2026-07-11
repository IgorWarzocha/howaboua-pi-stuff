import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { codexToolProviderEnv, CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE, resolveCodexToolProvider } from "../../adapter/codex-tool-provider.js";
import { WEB_SEARCH_TOOL_NAME } from "../../adapter/activation/tool-set.js";
import { renderCodexToolCell } from "../../ui/tool-rendering/codex-tool-cell.js";
import { getBundledPathToolsBinDir } from "../path/binary.js";
export const WEB_SEARCH_UNSUPPORTED_MESSAGE = CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE;
export const WEB_SEARCH_SESSION_NOTE_TYPE = "codex-web-search-session-note";
const SearchQueryParameters = Type.Object({
    q: Type.String(),
    recency: Type.Optional(Type.Number({ description: "Recent days." })),
    domains: Type.Optional(Type.Array(Type.String(), { description: "Domains." })),
}, { additionalProperties: true });
const WEB_SEARCH_PARAMETERS = Type.Object({
    search_query: Type.Optional(Type.Array(SearchQueryParameters)),
    image_query: Type.Optional(Type.Array(SearchQueryParameters)),
    open: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), lineno: Type.Optional(Type.Number()) }, { additionalProperties: true }), { description: "ref_id or URL." })),
    click: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), id: Type.Number() }, { additionalProperties: true }))),
    find: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), pattern: Type.String() }, { additionalProperties: true }))),
    response_length: Type.Optional(Type.Union([Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")], { description: "Answer length." })),
    settings: Type.Optional(Type.Object({
        search_context_size: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
    }, { additionalProperties: true })),
}, { additionalProperties: true });
const ASSISTANT_CONTEXT_CHAR_LIMIT = 4_000;
function createEmptyResultComponent() { return new Container(); }
function firstString(value, key) {
    if (!value || typeof value !== "object")
        return undefined;
    const field = value[key];
    return typeof field === "string" && field.trim() ? field.trim() : undefined;
}
function webSearchCallDetail(params) {
    const search = Array.isArray(params["search_query"]) ? params["search_query"][0] : undefined;
    const image = Array.isArray(params["image_query"]) ? params["image_query"][0] : undefined;
    const open = Array.isArray(params["open"]) ? params["open"][0] : undefined;
    const click = Array.isArray(params["click"]) ? params["click"][0] : undefined;
    const find = Array.isArray(params["find"]) ? params["find"][0] : undefined;
    const query = firstString(search, "q") ?? firstString(image, "q");
    if (query)
        return query;
    const opened = firstString(open, "url") ?? firstString(open, "ref_id") ?? firstString(click, "ref_id");
    if (opened)
        return opened;
    const pattern = firstString(find, "pattern");
    if (pattern)
        return `'${pattern}'`;
    return undefined;
}
function safeSessionId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
export function webRunSessionStatePath(ctx) {
    const sessionManager = ctx.sessionManager;
    const sessionFile = sessionManager?.getSessionFile?.();
    const sessionId = sessionManager?.getSessionId?.();
    if (typeof sessionFile !== "string" || !sessionFile || typeof sessionId !== "string" || !sessionId)
        return undefined;
    return join(dirname(sessionFile), `.web-run-${safeSessionId(sessionId)}.json`);
}
function isResponseMessage(item) {
    return Boolean(item && typeof item === "object" && (!("type" in item) || item.type === "message") && "role" in item);
}
function isContextualUserText(text) {
    const trimmed = text.trimStart();
    return trimmed.startsWith("<environment_context>") || trimmed.startsWith("The conversation history before this point was compacted");
}
export function buildRecentWebSearchInput(items) {
    const visible = [];
    for (const item of items) {
        if (!isResponseMessage(item))
            continue;
        if (item.role === "assistant") {
            visible.push(item);
            continue;
        }
        if (item.role !== "user" || !Array.isArray(item.content))
            continue;
        const content = item.content.filter((block) => block?.type === "input_text" && typeof block.text === "string" && !isContextualUserText(block.text));
        if (content.length > 0)
            visible.push({ ...item, type: "message", content });
    }
    let userCount = 0;
    let start = visible.length;
    let latestUser = -1;
    for (let index = visible.length - 1; index >= 0; index--) {
        const item = visible[index];
        if (isResponseMessage(item) && item.role === "user") {
            if (latestUser === -1)
                latestUser = index;
            userCount++;
        }
        if (userCount >= 2) {
            start = index;
            break;
        }
    }
    const end = latestUser === -1 ? visible.length : latestUser + 1;
    const recent = visible.slice(userCount >= 2 ? start : 0, end);
    for (const item of recent) {
        if (!isResponseMessage(item) || item.role !== "assistant" || !Array.isArray(item.content))
            continue;
        let remaining = ASSISTANT_CONTEXT_CHAR_LIMIT;
        item.content = item.content.map((block) => {
            if (block?.type !== "output_text" || typeof block.text !== "string")
                return block;
            const text = block.text.slice(0, Math.max(0, remaining));
            remaining -= text.length;
            return { ...block, text };
        }).filter((block) => block?.type !== "output_text" || block.text.length > 0);
    }
    return recent.length > 0 ? recent : undefined;
}
async function runWebRunBinary(webRunPath, params, env, signal) {
    return new Promise((resolve, reject) => {
        const child = spawn(webRunPath, ["-"], { env, signal: signal ?? undefined, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0)
                resolve(stdout);
            else
                reject(new Error(stderr.trim() || `web_run exited with code ${code ?? "unknown"}`));
        });
        child.stdin.end(JSON.stringify(params));
    });
}
function formatWebRunOutput(parsed) {
    const encryptedOutput = parsed["encrypted_output"];
    if (typeof encryptedOutput === "string" && encryptedOutput.trim())
        return encryptedOutput;
    if (parsed["search_results"] !== undefined)
        return JSON.stringify(parsed, null, 2);
    if (Array.isArray(parsed["content"]) || Array.isArray(parsed["open"]) || Array.isArray(parsed["find"]))
        return JSON.stringify(parsed, null, 2);
    const outputText = parsed["output_text"] ?? parsed["text"];
    return typeof outputText === "string" && outputText.trim() ? outputText : undefined;
}
export function supportsNativeWebSearch(model) {
    return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses"));
}
function supportsExecutableWebSearch(model, options) {
    return supportsNativeWebSearch(model) || Boolean(options.allowConfiguredProvider?.(model));
}
export function supportsMultimodalNativeWebSearch(model, options = {}) {
    if (!options.force && !supportsNativeWebSearch(model))
        return false;
    return !(model?.id ?? "").toLowerCase().includes("spark");
}
export async function executeCodexWebSearch(params, ctx, signal, options = {}) {
    const provider = await resolveCodexToolProvider(ctx);
    const webRunPath = process.env["PI_CODEX_WEB_RUN_BIN"]?.trim() || join(getBundledPathToolsBinDir(), process.platform === "win32" ? "web_run.cmd" : "web_run");
    const sessionId = ctx.sessionManager?.getSessionId?.() || options.sessionId;
    const model = typeof options.model === "function" ? options.model() : options.model;
    const statePath = webRunSessionStatePath(ctx);
    const env = { ...codexToolProviderEnv(provider), ...(statePath ? { PI_WEB_RUN_STATE_PATH: statePath } : {}) };
    try {
        const input = options.getRecentInput?.();
        const stdout = await runWebRunBinary(webRunPath, { ...params, id: sessionId, ...(model ? { model } : {}), ...(input ? { input } : {}) }, env, signal);
        const parsed = JSON.parse(stdout);
        const output = formatWebRunOutput(parsed);
        if (output)
            return { text: output, details: parsed };
        throw new Error("web_run search returned no output");
    }
    catch (error) {
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
        const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
        throw new Error(message);
    }
}
export function createWebSearchTool(name = WEB_SEARCH_TOOL_NAME, options = {}) {
    const toolOptions = { sessionId: randomUUID(), ...options };
    return {
        name,
        label: name,
        description: "Search/open web.",
        ...(toolOptions.promptSnippet === false ? {} : { promptSnippet: "Use explicit args." }),
        parameters: WEB_SEARCH_PARAMETERS,
        prepareArguments: (args) => args && typeof args === "object" ? args : {},
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (!supportsExecutableWebSearch(ctx.model, toolOptions))
                throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
            const output = await executeCodexWebSearch(params, ctx, signal, toolOptions);
            return { content: [{ type: "text", text: output.text }], details: { webRun: output.details } };
        },
        ...(toolOptions.customRendering === false ? {} : {
            renderCall(args, theme) { return renderCodexToolCell("Searched the web", webSearchCallDetail(args), theme); },
            renderResult(result, { expanded }, theme) {
                if (!expanded)
                    return createEmptyResultComponent();
                const textBlock = result.content.find((item) => item.type === "text");
                return new Text(theme.fg("dim", textBlock?.type === "text" ? textBlock.text : "(no output)"), 0, 0);
            },
        }),
    };
}
export function registerWebSearchTool(pi, name = WEB_SEARCH_TOOL_NAME, options = {}) { pi.registerTool(createWebSearchTool(name, options)); }
