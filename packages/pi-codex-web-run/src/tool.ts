import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static } from "@earendil-works/pi-schema";
import { Container, Text } from "@earendil-works/pi-tui";
import { codexLoginDiagnostic } from "./codex-runtime/auth-diagnostics.js";
import {
	WEB_SEARCH_PARAMETERS,
	WEB_SEARCH_TOOL_NAME,
	type WebSearchToolOptions,
} from "./contract.js";
import {
	executeCodexWebSearch,
	supportsExecutableWebSearch,
} from "./execute.js";
import { renderWebSearchCall } from "./render.js";

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
			: { promptSnippet: "Explicit args" }),
		promptGuidelines: [
			"web_run: navigation→returned ref_ids; cite only Markdown links to result URLs",
		],
		parameters: WEB_SEARCH_PARAMETERS,
		prepareArguments: (args) =>
			args && typeof args === "object" ? (args as Record<string, unknown>) : {},
		async execute(
			_toolCallId,
			params: Static<typeof WEB_SEARCH_PARAMETERS>,
			signal,
			_onUpdate,
			ctx,
		) {
			if (!supportsExecutableWebSearch(ctx.model, toolOptions))
				throw new Error(codexLoginDiagnostic());
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
					renderCall: renderWebSearchCall,
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
