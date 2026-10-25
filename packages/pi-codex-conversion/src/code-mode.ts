import type {
	AgentToolResult,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { protectedOutputScope } from "./tools/code-mode/protected-output.ts";
export { canDeliverProtectedOutput, resolveActiveCodexProvider, resolveProtectedOutputScope, protectedAccountScope, bindProtectedOutputScope, protectedOutputScope } from "./tools/code-mode/protected-output.ts";

import type { TSchema } from "typebox";
import { toNestedTool } from "./adapter/code-mode/nested-tool-adapter.ts";
import { codeModeGlobalName, codeModeNameForToolIdentity } from "./tools/code-mode/tool-identity.ts";

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
	options: ({ discovery: "help"; usage?: string } | { discovery?: undefined; usage: string }) & {
		blocking?: boolean | ((input: unknown) => boolean);
		deferLoading?: boolean;
		kind?: "function" | "freeform";
		inputOptional?: boolean;
		promptMetadata?: boolean;
		/** Capture protected outputs while permitting ordinary local results. */
		opaqueResult?: boolean;
		propagateTermination?: boolean;
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
	const usage = options.usage ?? `await tools.${codeModeGlobalName(nestedTool.name)}()`;
	const adapted = toNestedTool(nestedTool, usage, {}, {
		modelVisibleResult: true,
		executeViaPi: tool.name,
		...(options.opaqueResult ? { opaqueResult: true, allowPlainResult: true, opaqueResultScope: result => protectedOutputScope(result.details) } : {}),
		...(options.propagateTermination ? { propagateTermination: true } : {}),
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
	return { ...adapted, ...(options.discovery ? { discovery: options.discovery } : {}), ...(options.inputOptional ? { inputOptional: true } : {}), topLevelName: tool.name };
}
