import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/tool-set.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";

export const WEB_SEARCH_UNSUPPORTED_MESSAGE = "web_run requires an OpenAI Codex-compatible Responses provider";
export const WEB_SEARCH_SESSION_NOTE_TYPE = "codex-web-search-session-note";

const DEFAULT_ALPHA_SEARCH_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_WEB_SEARCH_MODEL = "gpt-5.4-mini";
const WEB_SEARCH_PARAMETERS = Type.Unsafe<Record<string, unknown>>({ type: "object", additionalProperties: true });
type WebSearchArgs = Record<string, unknown>;

function createEmptyResultComponent(): Container { return new Container(); }

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

function pruneUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(pruneUndefined).filter((item) => item !== undefined);
	if (!value || typeof value !== "object") return value;
	const entries = Object.entries(value).flatMap(([key, item]) => {
		const pruned = pruneUndefined(item);
		return pruned === undefined ? [] : [[key, pruned] as const];
	});
	return Object.fromEntries(entries);
}

function defaultSettings(): Record<string, unknown> {
	return {
		allowed_callers: ["direct"],
		external_web_access: true,
	};
}

function resolveAlphaSearchUrl(baseUrl: string | undefined): string {
	const base = (baseUrl?.trim() || DEFAULT_ALPHA_SEARCH_BASE_URL).replace(/\/+$/, "");
	if (base.endsWith("/alpha/search")) return base;
	if (base.endsWith("/codex/responses")) return `${base.slice(0, -"/codex/responses".length)}/alpha/search`;
	if (base.endsWith("/codex")) return `${base.slice(0, -"/codex".length)}/alpha/search`;
	return `${base}/alpha/search`;
}

async function resolveAuth(ctx: ExtensionContext): Promise<Headers> {
	if (!ctx.model) throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);
	const apiKey = auth.apiKey ?? auth.headers?.["Authorization"]?.replace(/^Bearer\s+/i, "");
	if (!apiKey) throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
	const headers = new Headers();
	for (const [key, value] of Object.entries(auth.headers ?? {})) headers.set(key, value);
	headers.set("Authorization", `Bearer ${apiKey}`);
	if (!headers.has("chatgpt-account-id")) headers.set("chatgpt-account-id", extractAccountId(apiKey));
	// Match Codex's alpha/search client closely. `pi` works for codex/responses but
	// alpha/search is fussier and may route non-Codex originators through CF challenge pages.
	headers.set("originator", "codex_cli_rs");
	headers.set("User-Agent", "codex_cli_rs/pi-codex-conversion");
	headers.set("content-type", "application/json");
	headers.set("accept", "application/json");
	headers.delete("OpenAI-Beta");
	headers.delete("openai-beta");
	return headers;
}

export function buildAlphaSearchRequest(args: WebSearchArgs, ctx: Pick<ExtensionContext, "model">): Record<string, unknown> {
	const commands = { ...args };
	const explicitInput = commands["input"];
	const explicitSettings = commands["settings"];
	const explicitModel = commands["model"];
	const maxOutputTokens = commands["max_output_tokens"];
	delete commands["input"];
	delete commands["settings"];
	delete commands["model"];
	delete commands["max_output_tokens"];

	const settings = explicitSettings && typeof explicitSettings === "object"
		? { ...defaultSettings(), ...(explicitSettings as Record<string, unknown>) }
		: defaultSettings();

	return pruneUndefined({
		id: `pi-web-run-${Date.now().toString(36)}`,
		model: typeof explicitModel === "string" && explicitModel.trim() ? explicitModel : ctx.model?.id ?? DEFAULT_WEB_SEARCH_MODEL,
		input: typeof explicitInput === "string" && explicitInput.trim() ? explicitInput : undefined,
		commands: Object.keys(commands).length > 0 ? commands : undefined,
		settings,
		max_output_tokens: typeof maxOutputTokens === "number" ? maxOutputTokens : undefined,
	}) as Record<string, unknown>;
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

function webRunHttpError(status: number, body: string): Error {
	if (status === 403 && /cloudflare|challenge|just a moment|enable javascript/i.test(body)) {
		return new Error("web_run search failed: HTTP 403 Cloudflare challenge from alpha/search");
	}
	return new Error(`web_run search failed: HTTP ${status}${body.trim() ? ` ${body.slice(0, 500)}` : ""}`);
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
			const response = await fetch(resolveAlphaSearchUrl(ctx.model?.baseUrl), {
				method: "POST",
				headers: await resolveAuth(ctx),
				signal: signal ?? null,
				body: JSON.stringify(buildAlphaSearchRequest(params, ctx)),
			});
			const body = await response.text();
			if (!response.ok) throw webRunHttpError(response.status, body);
			const encryptedOutput = parseEncryptedOutput(body);
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
