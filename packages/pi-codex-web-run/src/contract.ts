import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CodexToolProvider } from "./codex-runtime/types.js";

export const WEB_SEARCH_TOOL_NAME = "web_run";
export const WEB_SEARCH_UNSUPPORTED_MESSAGE =
	"web_run requires an OpenAI Codex-compatible Responses provider or /login openai-codex";
export const DEFAULT_WEB_SEARCH_MODEL = "gpt-5.6-luna";
export const WEB_SEARCH_MAX_OUTPUT_TOKENS = 2_500;
export const WEB_SEARCH_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const SearchQueryParameters = Type.Object(
	{
		q: Type.String(),
		recency: Type.Optional(Type.Number({ description: "Days" })),
		domains: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: true },
);

export const WEB_SEARCH_PARAMETERS = Type.Object(
	{
		search_query: Type.Optional(Type.Array(SearchQueryParameters)),
		image_query: Type.Optional(Type.Array(SearchQueryParameters)),
		open: Type.Optional(
			Type.Array(
				Type.Object(
					{
						ref_id: Type.String(),
						lineno: Type.Optional(Type.Number()),
					},
					{ additionalProperties: true },
				),
				{ description: "ref_id or URL" },
			),
		),
		click: Type.Optional(
			Type.Array(
				Type.Object(
					{ ref_id: Type.String(), id: Type.Number() },
					{ additionalProperties: true },
				),
			),
		),
		find: Type.Optional(
			Type.Array(
				Type.Object(
					{ ref_id: Type.String(), pattern: Type.String() },
					{ additionalProperties: true },
				),
			),
		),
		response_length: Type.Optional(
			Type.Union([
				Type.Literal("short"),
				Type.Literal("medium"),
				Type.Literal("long"),
			]),
		),
		settings: Type.Optional(
			Type.Object(
				{
					search_context_size: Type.Optional(
						Type.Union([
							Type.Literal("low"),
							Type.Literal("medium"),
							Type.Literal("high"),
						]),
					),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
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
