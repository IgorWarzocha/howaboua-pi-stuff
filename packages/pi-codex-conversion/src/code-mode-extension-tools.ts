import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { NOTEBOOK_MODE_TOOL_NAMES } from "./adapter/activation/tool-set.ts";
import { codeModeGlobalName } from "./tools/code-mode/tool-identity.ts";
import type { ProgrammaticCodeModeToolDefinition } from "./tools/code-mode/types.ts";

const EXTENSION_TOOLS_CHANNEL =
	"@howaboua/pi-codex-conversion.extension-code-mode-tools/v1";
const RESERVED_EXTENSION_TOOL_NAMES = new Set(NOTEBOOK_MODE_TOOL_NAMES);

export type CodeModeExtensionToolProvider = (
	context: ExtensionContext | undefined,
) => readonly ProgrammaticCodeModeToolDefinition[];

interface ExtensionToolsRequest {
	context: ExtensionContext | undefined;
	add(provider: CodeModeExtensionToolProvider): void;
}

export function registerCodeModeExtensionTools(
	pi: ExtensionAPI,
	provider: CodeModeExtensionToolProvider,
): () => void {
	return pi.events.on(EXTENSION_TOOLS_CHANNEL, (value) => {
		if (isExtensionToolsRequest(value)) value.add(provider);
	});
}

export function getCodeModeExtensionTools(
	pi: ExtensionAPI,
	context: ExtensionContext | undefined,
): ProgrammaticCodeModeToolDefinition[] {
	const providers: CodeModeExtensionToolProvider[] = [];
	pi.events.emit(EXTENSION_TOOLS_CHANNEL, {
		context,
		add(provider) {
			providers.push(provider);
		},
	} satisfies ExtensionToolsRequest);
	const tools = providers.flatMap((provider) => provider(context));
	for (const tool of tools) {
		if (RESERVED_EXTENSION_TOOL_NAMES.has(codeModeGlobalName(tool.name)))
			throw new Error(`Reserved Code Mode extension tool name: ${tool.name}`);
	}
	return tools;
}

function isExtensionToolsRequest(value: unknown): value is ExtensionToolsRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"add" in value &&
			typeof value.add === "function",
	);
}
