import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import {
	WEB_SEARCH_PARAMETERS,
	WEB_SEARCH_TOOL_NAME,
	WEB_SEARCH_UNSUPPORTED_MESSAGE,
	type WebSearchToolOptions,
} from "./contract.js";
import {
	executeCodexWebSearch,
	supportsExecutableWebSearch,
} from "./execute.js";
import { renderToolCell } from "./render.js";

function firstString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function webSearchCallDetail(
	params: Record<string, unknown>,
): string | undefined {
	const search = Array.isArray(params["search_query"])
		? params["search_query"][0]
		: undefined;
	const image = Array.isArray(params["image_query"])
		? params["image_query"][0]
		: undefined;
	const open = Array.isArray(params["open"]) ? params["open"][0] : undefined;
	const click = Array.isArray(params["click"]) ? params["click"][0] : undefined;
	const find = Array.isArray(params["find"]) ? params["find"][0] : undefined;
	const query = firstString(search, "q") ?? firstString(image, "q");
	if (query) return query;
	const opened =
		firstString(open, "url") ??
		firstString(open, "ref_id") ??
		firstString(click, "ref_id");
	if (opened) return opened;
	const pattern = firstString(find, "pattern");
	return pattern ? "'" + pattern + "'" : undefined;
}

export function createWebSearchTool(
	name: string = WEB_SEARCH_TOOL_NAME,
	options: WebSearchToolOptions = {},
): ToolDefinition<typeof WEB_SEARCH_PARAMETERS> {
	const toolOptions = { sessionId: randomUUID(), ...options };
	return {
		name,
		label: name,
		description: "Search/open web",
		...(toolOptions.promptSnippet === false
			? {}
			: { promptSnippet: "Use explicit args" }),
		promptGuidelines: [
			"web_run: Use turn-prefixed ref_ids only in tool calls. Final answers cite result URLs with Markdown links, never internal refs or cite... markers.",
		],
		parameters: WEB_SEARCH_PARAMETERS,
		prepareArguments: (args) =>
			args && typeof args === "object" ? (args as Record<string, unknown>) : {},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsExecutableWebSearch(ctx.model, toolOptions))
				throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
			const output = await executeCodexWebSearch(
				params,
				ctx,
				signal,
				toolOptions,
			);
			return {
				content: [{ type: "text", text: output.text }],
				details: { webRun: output.details },
			};
		},
		...(toolOptions.customRendering === false
			? {}
			: {
					renderCall(args, theme) {
						return renderToolCell(
							"Searched the web",
							webSearchCallDetail(args as Record<string, unknown>),
							theme,
						);
					},
					renderResult(result, { expanded }, theme) {
						if (!expanded) return new Container();
						const textBlock = result.content.find(
							(item) => item.type === "text",
						);
						return new Text(
							theme.fg(
								"dim",
								textBlock?.type === "text" ? textBlock.text : "(no output)",
							),
							0,
							0,
						);
					},
				}),
	};
}
