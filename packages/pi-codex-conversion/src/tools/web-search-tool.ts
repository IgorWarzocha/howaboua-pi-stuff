import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { codexToolProviderEnv, codexToolProviderHeaders, CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE, resolveCodexAlphaSearchUrl, resolveCodexToolProvider, type CodexToolProvider } from "../adapter/codex-tool-provider.ts";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/tool-set.ts";
import { attachChatGptCloudflareCookies, storeChatGptCloudflareCookies } from "./chatgpt-cloudflare-cookies.ts";

export const WEB_SEARCH_UNSUPPORTED_MESSAGE = CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE;
export const WEB_SEARCH_SESSION_NOTE_TYPE = "codex-web-search-session-note";

const WEB_SEARCH_PARAMETERS = Type.Unsafe<Record<string, unknown>>({ type: "object", additionalProperties: true });
const DEFAULT_WEB_SEARCH_MODEL = "gpt-5.4-mini";
function createEmptyResultComponent(): Container { return new Container(); }

async function runWebRunBinary(webRunPath: string, params: Record<string, unknown>, env: NodeJS.ProcessEnv, signal: AbortSignal | undefined | null): Promise<string> {
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
			if (code === 0) resolve(stdout);
			else reject(new Error(stderr.trim() || `web_run exited with code ${code ?? "unknown"}`));
		});
		child.stdin.end(JSON.stringify(params));
	});
}

export function resolveAlphaSearchUrlFromBase(baseUrl: string | undefined): string {
	return resolveCodexAlphaSearchUrl(baseUrl ?? "");
}

export function supportsNativeWebSearch(model: ExtensionContext["model"]): boolean {
	return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses"));
}

function supportsExecutableWebSearch(model: ExtensionContext["model"]): boolean {
	return supportsNativeWebSearch(model);
}

export function supportsMultimodalNativeWebSearch(model: ExtensionContext["model"], options: { force?: boolean | undefined } = {}): boolean {
	if (!options.force && !supportsNativeWebSearch(model)) return false;
	return !(model?.id ?? "").toLowerCase().includes("spark");
}

function parseEncryptedOutput(body: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body) as unknown;
	} catch {
		throw new Error("web_run search returned invalid JSON");
	}
	if (!parsed || typeof parsed !== "object") throw new Error("web_run search returned invalid JSON");
	const encryptedOutput = (parsed as Record<string, unknown>)["encrypted_output"];
	if (typeof encryptedOutput !== "string" || !encryptedOutput.trim()) throw new Error("web_run search returned no encrypted output");
	return encryptedOutput;
}

function mergeSearchSettings(settings: unknown): Record<string, unknown> {
	const merged = settings && typeof settings === "object" && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {};
	if (merged["allowed_callers"] === undefined) merged["allowed_callers"] = ["direct"];
	if (merged["external_web_access"] === undefined) merged["external_web_access"] = true;
	return merged;
}

export function buildCodexWebSearchRequest(params: Record<string, unknown>, provider: CodexToolProvider): Record<string, unknown> {
	const { model, input, settings, max_output_tokens, ...commands } = params;
	return {
		id: `pi-web-run-${randomUUID()}`,
		model: typeof model === "string" && model.trim() ? model : provider.model ?? DEFAULT_WEB_SEARCH_MODEL,
		...(typeof input === "string" ? { input } : {}),
		commands,
		settings: mergeSearchSettings(settings),
		...(typeof max_output_tokens === "number" ? { max_output_tokens } : {}),
	};
}

export async function executeCodexWebSearch(params: Record<string, unknown>, ctx: ExtensionContext, signal: AbortSignal | undefined | null): Promise<string> {
	if (process.env["PI_CODEX_WEB_RUN_TS_FETCH"] === "1") return executeCodexWebSearchFetch(params, ctx, signal);
	const provider = await resolveCodexToolProvider(ctx);
	const scriptDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
	const webRunPath = join(scriptDir, "bin", process.platform === "win32" ? "web_run.cmd" : "web_run");
	try {
		const stdout = await runWebRunBinary(webRunPath, params, codexToolProviderEnv(provider), signal);
		const parsed = JSON.parse(stdout) as Record<string, unknown>;
		const encryptedOutput = parsed["encrypted_output"];
		if (typeof encryptedOutput !== "string" || !encryptedOutput.trim()) throw new Error("web_run search returned no encrypted output");
		return encryptedOutput;
	} catch (error) {
		const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
		const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
		throw new Error(message);
	}
}

export async function executeCodexWebSearchFetch(params: Record<string, unknown>, ctx: ExtensionContext, signal: AbortSignal | undefined | null): Promise<string> {
	const provider = await resolveCodexToolProvider(ctx);
	const url = resolveCodexAlphaSearchUrl(provider.baseUrl);
	const headers = codexToolProviderHeaders(provider);
	attachChatGptCloudflareCookies(url, headers);
	const response = await fetch(url, {
		method: "POST",
		headers,
		signal: signal ?? null,
		body: JSON.stringify(buildCodexWebSearchRequest(params, provider)),
	});
	storeChatGptCloudflareCookies(url, response.headers);
	const body = await response.text();
	const cloudflareChallenge = response.headers.get("cf-mitigated") === "challenge" || (response.headers.get("server") ?? "").toLowerCase() === "cloudflare" && body.trimStart().startsWith("<html");
	if (!response.ok) {
		if (response.status === 403 && (cloudflareChallenge || body.toLowerCase().includes("cloudflare"))) throw new Error(`web_run alpha/search failed for \`${url}\`: HTTP 403 Cloudflare challenge`);
		throw new Error(`web_run alpha/search failed for \`${url}\`: HTTP ${response.status} ${body}`);
	}
	if (!body.trimStart().startsWith("{")) {
		if (cloudflareChallenge || body.toLowerCase().includes("cloudflare")) throw new Error(`web_run alpha/search failed for \`${url}\`: Cloudflare challenge`);
		throw new Error(`web_run alpha/search failed for \`${url}\`: expected JSON response`);
	}
	return parseEncryptedOutput(body);
}


export function createWebSearchTool(name: string = WEB_SEARCH_TOOL_NAME): ToolDefinition<typeof WEB_SEARCH_PARAMETERS> {
	return {
		name,
		label: name,
		description: "Search the web for sources relevant to the current task. Use it when you need up-to-date information, external references, or broader context beyond the workspace.",
		promptSnippet: "Search the web for sources relevant to the current task. Use it when you need up-to-date information, external references, or broader context beyond the workspace.",
		parameters: WEB_SEARCH_PARAMETERS,
		prepareArguments: (args) => args && typeof args === "object" ? args as Record<string, unknown> : {},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsExecutableWebSearch(ctx.model)) throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
			const encryptedOutput = await executeCodexWebSearch(params, ctx, signal);
			return { content: [{ type: "text", text: "[encrypted web search output]" }], details: { webRun: { encrypted_output: encryptedOutput } } };
		},
		renderCall(_args, theme) { return new Text(`${theme.fg("toolTitle", theme.bold(name))}`, 0, 0); },
		renderResult(result, { expanded }, theme) {
			if (!expanded) return createEmptyResultComponent();
			const textBlock = result.content.find((item) => item.type === "text");
			return new Text(theme.fg("dim", textBlock?.type === "text" ? textBlock.text : "(no output)"), 0, 0);
		},
	};
}

export function registerWebSearchTool(pi: ExtensionAPI, name: string = WEB_SEARCH_TOOL_NAME): void { pi.registerTool(createWebSearchTool(name)); }
