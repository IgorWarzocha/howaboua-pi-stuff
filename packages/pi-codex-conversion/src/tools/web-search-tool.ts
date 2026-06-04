import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { isOpenAICodexModel } from "../adapter/codex-model.ts";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/tool-set.ts";

export const WEB_SEARCH_UNSUPPORTED_MESSAGE = "web.run is only available with the openai-codex provider";
const WEB_SEARCH_LOCAL_EXECUTION_MESSAGE =
	"web.run is a native openai-codex provider tool and should not execute locally";
export const WEB_SEARCH_SESSION_NOTE_TYPE = "codex-web-search-session-note";
const WEB_SEARCH_MULTIMODAL_CONTENT_TYPES = ["text", "image"] as const;

const WEB_SEARCH_PARAMETERS = Type.Unsafe<Record<string, never>>({
	type: "object",
	additionalProperties: false,
});

interface FunctionToolPayload {
	type?: unknown | undefined;
	name?: unknown | undefined;
}

interface ResponsesPayload {
	include?: unknown | undefined;
	tools?: unknown[] | undefined;
	[key: string]: unknown;
}

interface ResponsesWebSearchTool {
	type: "web_search";
	external_web_access: true;
	search_content_types?: string[] | undefined;
}

export function supportsNativeWebSearch(model: ExtensionContext["model"]): boolean {
	return isOpenAICodexModel(model);
}

export function supportsMultimodalNativeWebSearch(model: ExtensionContext["model"], options: { force?: boolean | undefined } = {}): boolean {
	if (!options.force && !supportsNativeWebSearch(model)) {
		return false;
	}
	const id = (model?.id ?? "").toLowerCase();
	return !id.includes("spark");
}

function isWebSearchFunctionTool(tool: unknown): tool is FunctionToolPayload {
	return !!tool && typeof tool === "object" && (tool as FunctionToolPayload).type === "function" && (tool as FunctionToolPayload).name === WEB_SEARCH_TOOL_NAME;
}

function createEmptyResultComponent(): Container {
	return new Container();
}

export function rewriteNativeWebSearchTool(payload: unknown, model: ExtensionContext["model"], options: { force?: boolean | undefined } = {}): unknown {
	if ((!options.force && !supportsNativeWebSearch(model)) || !payload || typeof payload !== "object") {
		return payload;
	}

	const tools = (payload as ResponsesPayload).tools;
	if (!Array.isArray(tools)) {
		return payload;
	}

	let rewritten = false;
	const nextTools = tools.map((tool) => {
		if (!isWebSearchFunctionTool(tool)) {
			return tool;
		}
		rewritten = true;
		// Match Codex's native tool shape rather than exposing a synthetic function tool.
		const nativeTool: ResponsesWebSearchTool = {
			type: "web_search",
			external_web_access: true,
		};
		if (supportsMultimodalNativeWebSearch(model, options)) {
			nativeTool.search_content_types = [...WEB_SEARCH_MULTIMODAL_CONTENT_TYPES];
		}
		return nativeTool;
	});

	if (!rewritten) {
		return payload;
	}
	const existingInclude: unknown[] = Array.isArray((payload as ResponsesPayload).include)
		? [...((payload as ResponsesPayload).include as unknown[])]
		: [];
	const include = [
		...existingInclude,
		...[
			"web_search_call.action.sources",
			"web_search_call.results",
		].filter((item) => !existingInclude.includes(item)),
	];

	return {
		...(payload as ResponsesPayload),
		include,
		tools: nextTools,
	};
}

export function createWebSearchTool(name: string = WEB_SEARCH_TOOL_NAME): ToolDefinition<typeof WEB_SEARCH_PARAMETERS> {
	return {
		name,
		label: name,
		description:
			"Search the web for sources relevant to the current task. Use it when you need up-to-date information, external references, or broader context beyond the workspace.",
		promptSnippet:
			"Search the web for sources relevant to the current task. Use it when you need up-to-date information, external references, or broader context beyond the workspace.",
		parameters: WEB_SEARCH_PARAMETERS,
		prepareArguments: () => ({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (!supportsNativeWebSearch(ctx.model)) {
				throw new Error(WEB_SEARCH_UNSUPPORTED_MESSAGE);
			}
			throw new Error(WEB_SEARCH_LOCAL_EXECUTION_MESSAGE);
		},
		renderCall(_args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold(name))}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			if (!expanded) {
				return createEmptyResultComponent();
			}
			const textBlock = result.content.find((item) => item.type === "text");
			const text = textBlock?.type === "text" ? textBlock.text : "(no output)";
			return new Text(theme.fg("dim", text), 0, 0);
		},
	};
}

export function registerWebSearchTool(pi: ExtensionAPI, name: string = WEB_SEARCH_TOOL_NAME): void {
	pi.registerTool(createWebSearchTool(name));
}
