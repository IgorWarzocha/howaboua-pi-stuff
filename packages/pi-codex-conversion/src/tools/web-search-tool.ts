import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/tool-set.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";
import { getBundledPathToolsBinDir } from "./path-tools-binary.ts";

export const WEB_SEARCH_UNSUPPORTED_MESSAGE = "web_run requires an OpenAI Codex-compatible Responses provider";
export const WEB_SEARCH_SESSION_NOTE_TYPE = "codex-web-search-session-note";

const WEB_SEARCH_PARAMETERS = Type.Unsafe<Record<string, unknown>>({ type: "object", additionalProperties: true });
const execFileAsync = promisify(execFile);

function createEmptyResultComponent(): Container { return new Container(); }

export function resolveAlphaSearchUrlFromBase(baseUrl: string | undefined): string {
	const explicitAlphaBase = process.env["PI_CODEX_ALPHA_BASE_URL"];
	if (explicitAlphaBase?.trim()) return alphaSearchUrlFromBase(explicitAlphaBase);
	const serverUri = process.env["PI_CODEX_SERVER_URI"];
	if (serverUri?.trim()) return `${serverUri.trim().replace(/\/+$/, "")}/api/codex/alpha/search`;
	return alphaSearchUrlFromBase(baseUrl?.trim() || "https://chatgpt.com/backend-api/codex");
}

function alphaSearchUrlFromBase(baseUrl: string): string {
	const base = baseUrl.replace(/\/+$/, "");
	if (base.endsWith("/alpha/search")) return base;
	if (base.endsWith("/codex/responses")) return `${base.slice(0, -"/responses".length)}/alpha/search`;
	if (base.endsWith("/api/codex") || base.endsWith("/backend-api/codex") || base.endsWith("/codex")) return `${base}/alpha/search`;
	if (base.endsWith("/api") || base.endsWith("/backend-api")) return `${base}/codex/alpha/search`;
	return `${base}/api/codex/alpha/search`;
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

function pathToolExecutable(): string {
	return join(getBundledPathToolsBinDir(), process.platform === "win32" ? "web_run.cmd" : "web_run");
}

async function resolveNativeEnv(ctx: ExtensionContext): Promise<NodeJS.ProcessEnv> {
	if (!ctx.model) throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);
	const apiKey = auth.apiKey ?? auth.headers?.["Authorization"]?.replace(/^Bearer\s+/i, "");
	if (!apiKey) throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
	return {
		...process.env,
		PI_CODEX_ACCESS_TOKEN: apiKey,
		PI_CODEX_ACCOUNT_ID: auth.headers?.["chatgpt-account-id"] ?? extractAccountId(apiKey),
		...(ctx.model.baseUrl ? { PI_CODEX_BASE_URL: ctx.model.baseUrl, PI_CODEX_ALPHA_SEARCH_URL: resolveAlphaSearchUrlFromBase(ctx.model.baseUrl) } : {}),
		...(ctx.model.id ? { PI_CODEX_MODEL: ctx.model.id } : {}),
	};
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
			let stdout: string;
			try {
				const result = await execFileAsync(pathToolExecutable(), [JSON.stringify(params)], {
					env: await resolveNativeEnv(ctx),
					signal: signal ?? undefined,
					maxBuffer: 1024 * 1024 * 8,
				});
				stdout = result.stdout;
			} catch (error) {
				const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
				const message = stderr || (error instanceof Error ? error.message : String(error));
				throw new Error(message);
			}
			const encryptedOutput = parseEncryptedOutput(stdout);
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
