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
	options: {
		usage: string;
		blocking?: boolean | ((input: unknown) => boolean);
		deferLoading?: boolean;
	},
): ProgrammaticCodeModeToolDefinition {
	return toNestedTool(tool, options.usage, {}, {
		modelVisibleResult: true,
		translatePromptMetadata: true,
		...(options.blocking === true ? { blocking: true } : {}),
		...(typeof options.blocking === "function"
			? { isBlocking: options.blocking }
			: {}),
		...(options.deferLoading
			? { deferLoading: true, discoverWhenDeferred: true }
			: {}),
	});
}
