import type {
	AgentToolResult,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { toNestedTool } from "./adapter/code-mode/nested-tool-adapter.ts";
import { codeModeNameForToolIdentity } from "./tools/code-mode/tool-identity.ts";

export {
	type CodeModeExtensionToolProvider,
	type CodeModeExtensionToolRegistration,
	type CodeModeExtensionToolRegistrationOptions,
	registerCodeModeExtensionTools,
} from "./code-mode-extension-tools.ts";

import type { CodeModeToolIdentity, ProgrammaticCodeModeToolDefinition } from "./tools/code-mode/types.ts";

export function adaptToolForCodeMode<
	TParams extends TSchema,
	TDetails,
	TState,
>(
	tool: ToolDefinition<TParams, TDetails, TState>,
	options: {
		usage: string;
		blocking?: boolean | ((input: unknown) => boolean);
		deferLoading?: boolean;
		kind?: "function" | "freeform";
		promptMetadata?: boolean;
		prepareInput?(input: unknown): unknown;
		toolName?: CodeModeToolIdentity;
		resultValue?(result: AgentToolResult<NoInfer<TDetails>>): unknown;
	},
): ProgrammaticCodeModeToolDefinition {
	if (options.kind === "freeform" && !options.prepareInput) {
		throw new Error("Freeform Code Mode tools require prepareInput");
	}
	const nestedTool = options.toolName
		? { ...tool, name: codeModeNameForToolIdentity(options.toolName) }
		: tool;
	const adapted = toNestedTool(nestedTool, options.usage, {}, {
		modelVisibleResult: true,
		translatePromptMetadata: options.promptMetadata !== false,
		...(options.kind ? { kind: options.kind } : {}),
		...(options.prepareInput ? { prepareInput: options.prepareInput } : {}),
		...(options.toolName ? { toolName: options.toolName } : {}),
		...(options.resultValue ? { resultValue: options.resultValue as (result: AgentToolResult<unknown>) => unknown } : {}),
		...(options.blocking === true ? { blocking: true } : {}),
		...(typeof options.blocking === "function"
			? { isBlocking: options.blocking }
			: {}),
		...(options.deferLoading
			? { deferLoading: true, discoverWhenDeferred: true }
			: {}),
	});
	return { ...adapted, topLevelName: tool.name };
}
