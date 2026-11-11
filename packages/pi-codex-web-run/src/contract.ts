import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { arr, lit, num, obj, opt, str, union } from "@earendil-works/pi-schema";
import type { CodexToolProvider } from "./codex-runtime/types.js";

export const WEB_SEARCH_TOOL_NAME = "web_run";
export const DEFAULT_WEB_SEARCH_MODEL = "gpt-6-luna";
export const WEB_SEARCH_MAX_OUTPUT_TOKENS = 2_500;
export const WEB_SEARCH_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const SearchQueryParameters = obj(
	{
		q: str(),
		recency: opt(num({ description: "Days" })),
		domains: opt(arr(str())),
	},
	{ open: true },
);

export const WEB_SEARCH_PARAMETERS = obj(
	{
		search_query: opt(arr(SearchQueryParameters)),
		image_query: opt(arr(SearchQueryParameters)),
		open: opt(
			arr(
				obj(
					{
						ref_id: str(),
						lineno: opt(num()),
					},
					{ open: true },
				),
				{ description: "ref_id or URL" },
			),
		),
		click: opt(arr(obj({ ref_id: str(), id: num() }, { open: true }))),
		find: opt(arr(obj({ ref_id: str(), pattern: str() }, { open: true }))),
		response_length: opt(
			union([
				{ ...lit("short"), type: "string" },
				{ ...lit("medium"), type: "string" },
				{ ...lit("long"), type: "string" },
			]),
		),
		settings: opt(
			obj(
				{
					search_context_size: opt(
						union([
							{ ...lit("low"), type: "string" },
							{ ...lit("medium"), type: "string" },
							{ ...lit("high"), type: "string" },
						]),
					),
				},
				{ open: true },
			),
		),
	},
	{ open: true },
);

export type WebRunOutput = Record<string, unknown> & {
	output_text?: string;
	search_results?: unknown[];
};

export type CodexToolProviderResolver = (
	ctx: ExtensionContext,
) => Promise<CodexToolProvider | undefined>;

export interface WebSearchToolOptions {
	sessionId?: string;
	model?: string | (() => string | undefined);
	allowConfiguredProvider?: (model: ExtensionContext["model"]) => boolean;
	resolveProvider?: CodexToolProviderResolver;
	allowCodexProviderFallback?: boolean;
	customRendering?: boolean;
	promptSnippet?: boolean;
}
