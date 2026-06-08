import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/tool-set.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";

export const WEB_SEARCH_UNSUPPORTED_MESSAGE = "web_run requires an OpenAI Codex-compatible Responses provider";
export const WEB_SEARCH_SESSION_NOTE_TYPE = "codex-web-search-session-note";

const WEB_SEARCH_PARAMETERS = Type.Unsafe<Record<string, unknown>>({ type: "object", additionalProperties: true });
type WebSearchArgs = Record<string, unknown>;

function createEmptyResultComponent(): Container { return new Container(); }

export function supportsNativeWebSearch(model: ExtensionContext["model"]): boolean {
	return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses"));
}

function supportsExecutableWebSearch(model: ExtensionContext["model"]): boolean {
	return supportsNativeWebSearch(model) || ((model?.provider ?? "").toLowerCase() !== "openai" && Boolean(model?.api?.includes("responses")));
}

export function supportsMultimodalNativeWebSearch(model: ExtensionContext["model"], options: { force?: boolean | undefined } = {}): boolean {
	if (!options.force && !supportsNativeWebSearch(model)) return false;
	return !(model?.id ?? "").toLowerCase().includes("spark");
}

function firstQuery(args: WebSearchArgs): string | undefined {
	const pickQ = (key: string) => {
		const values = args[key];
		return Array.isArray(values) && values[0] && typeof values[0] === "object" && typeof (values[0] as { q?: unknown }).q === "string" ? (values[0] as { q: string }).q : undefined;
	};
	const open = args["open"];
	return pickQ("search_query") ?? pickQ("image_query") ?? (Array.isArray(open) && open[0] && typeof open[0] === "object" && typeof (open[0] as { ref_id?: unknown }).ref_id === "string" ? `open ${(open[0] as { ref_id: string }).ref_id}` : undefined);
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
	headers.set("originator", "pi");
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("content-type", "application/json");
	headers.set("accept", "text/event-stream");
	return headers;
}
function resolveAlphaSearchUrl(baseUrl: string | undefined): string {
	const base = (baseUrl ?? "https://chatgpt.com/backend-api").replace(/\/+$/, "");
	if (base.endsWith("/alpha/search")) return base;
	if (base.endsWith("/codex/responses")) return `${base.slice(0, -"/codex/responses".length)}/alpha/search`;
	if (base.endsWith("/codex")) return `${base.slice(0, -"/codex".length)}/alpha/search`;
	return `${base}/alpha/search`;
}

function buildRequest(args: WebSearchArgs, ctx: ExtensionContext): Record<string, unknown> {
	const settings = args["settings"] && typeof args["settings"] === "object" ? args["settings"] as Record<string, unknown> : undefined;
	const input = typeof args["input"] === "string" ? args["input"] : firstQuery(args);
	const commands = { ...args };
	delete commands["model"];
	delete commands["input"];
	delete commands["settings"];
	return {
		id: `pi-web-run-${Date.now().toString(36)}`,
		model: ctx.model?.id ?? "gpt-5.4-mini",
		...(input ? { input } : {}),
		commands,
		...(settings ? { settings } : {}),
	};
}

function formatWebRunOutput(): string {
	return "[encrypted web search output]";
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
			const response = await fetch(resolveAlphaSearchUrl(ctx.model?.baseUrl), { method: "POST", headers: await resolveAuth(ctx), signal: signal ?? null, body: JSON.stringify(buildRequest(params, ctx)) });
			const body = await response.text();
			if (!response.ok) throw new Error(`web_run search failed: HTTP ${response.status} ${body}`);
			const parsed = JSON.parse(body) as { encrypted_output?: unknown };
			if (typeof parsed.encrypted_output !== "string" || !parsed.encrypted_output) throw new Error("web_run search returned no encrypted output");
			return { content: [{ type: "text", text: formatWebRunOutput() }], details: { webRun: { encrypted_output: parsed.encrypted_output } } };
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
