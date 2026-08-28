import type {
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { toNestedTool } from "./adapter/code-mode/nested-tool-adapter.ts";

export {
	type CodeModeExtensionToolProvider,
	type CodeModeExtensionToolRegistration,
	type CodeModeExtensionToolRegistrationOptions,
	registerCodeModeExtensionTools,
} from "./code-mode-extension-tools.ts";

import type { ProgrammaticCodeModeToolDefinition } from "./tools/code-mode/types.ts";

export function adaptToolForCodeMode<
	TParams extends TSchema,
	TDetails,
	TState,
>(
	tool: ToolDefinition<TParams, TDetails, TState>,
	options: { usage: string; blocking?: boolean; deferLoading?: boolean },
): ProgrammaticCodeModeToolDefinition {
	return toNestedTool(tool, options.usage, {}, {
		modelVisibleResult: true,
		translatePromptMetadata: true,
		...(options.blocking ? { blocking: true } : {}),
		...(options.deferLoading
			? { deferLoading: true, discoverWhenDeferred: true }
			: {}),
	});
}
