import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type GippityControlConfig,
	GIPPITY_VOICE_MODEL_OPTIONS,
} from "../config.ts";
import { type CodexVoiceAuth, resolveCodexVoiceAuth } from "./auth.ts";
import { resolveRealtimeProvider } from "./realtime-provider.ts";
import {
	collectGippityVoiceTools,
	type GippityToolRegistry,
} from "./realtime-tools.ts";
import { discoverRealtimeWebSearch } from "./realtime-web-search.ts";

export interface PublicRealtimeAccess {
	tools: GippityToolRegistry;
	ctx: ExtensionContext;
}

/** API keys only: Sign in with ChatGPT is not public Realtime API access. */
async function resolvePublicRealtimeAuth(
	ctx: ExtensionContext,
	provider: string,
	pi?: ExtensionAPI,
	webSearch = false,
): Promise<CodexVoiceAuth> {
	const access = await resolveRealtimeProvider(ctx, provider);
	const tools: GippityToolRegistry = pi
		? collectGippityVoiceTools(pi)
		: {
				definitions: [],
				async execute() {
					throw new Error("Voice tool unavailable");
				},
			};
	const search = webSearch && pi ? discoverRealtimeWebSearch(pi) : undefined;
	if (webSearch && pi && !search)
		throw new Error(
			"Voice web search is enabled but Web Run is unavailable. Load pi-codex-web-run or turn off voice web search, then start again.",
		);
	const registry: GippityToolRegistry = search
		? {
				definitions: [
					...tools.definitions,
					{
						type: "function",
						name: "web_search",
						description: "Search the web",
						parameters: {
							type: "object",
							properties: { query: { type: "string" } },
							required: ["query"],
							additionalProperties: false,
						},
					},
				],
				async execute(name, args, context) {
					if (name !== "web_search") return tools.execute(name, args, context);
					if (
						!args ||
						typeof args !== "object" ||
						Array.isArray(args) ||
						!("query" in args) ||
						typeof args.query !== "string" ||
						!args.query.trim() ||
						Buffer.byteLength(args.query) > 8192 ||
						Object.keys(args).some((key) => key !== "query")
					)
						throw new Error("web_search requires only a nonempty query");
					const result = await search.run(
						ctx,
						{ search_query: [{ q: args.query }] },
						context.signal,
					);
					// The tool-result limit measures JSON, including escaped text.
					const maxBytes = 24 * 1024;
					if (Buffer.byteLength(JSON.stringify(result.text)) <= maxBytes)
						return result.text;
					const notice = "\n[Search result truncated; narrow the query]";
					let remaining = maxBytes - Buffer.byteLength(JSON.stringify(notice));
					let excerpt = "";
					for (const character of result.text) {
						const bytes = Buffer.byteLength(JSON.stringify(character)) - 2;
						if (bytes > remaining) break;
						excerpt += character;
						remaining -= bytes;
					}
					return excerpt + notice;
				},
			}
		: tools;
	return {
		...access,
		officialCodex: false,
		realtime: { ctx, tools: registry },
	};
}

export async function resolveRealtimeVoiceAuth(
	ctx: ExtensionContext,
	config: {
		voice: Pick<
			GippityControlConfig["voice"],
			"model" | "apiProvider" | "webSearch"
		>;
	},
	pi?: ExtensionAPI,
): Promise<CodexVoiceAuth> {
	switch (GIPPITY_VOICE_MODEL_OPTIONS[config.voice.model].kind) {
		case "codex":
			return resolveCodexVoiceAuth(ctx);
		case "live":
			return {
				...(await resolveRealtimeProvider(ctx, config.voice.apiProvider)),
				officialCodex: false,
			};
		case "realtime":
			return resolvePublicRealtimeAuth(
				ctx,
				config.voice.apiProvider,
				pi,
				config.voice.webSearch,
			);
	}
}
