import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ProgrammaticCodeModeToolDefinition } from "./tools/code-mode/types.ts";

const EXTENSION_TOOLS_CHANNEL =
	"@howaboua/pi-codex-conversion.extension-code-mode-tools/v1";

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
	return providers.flatMap((provider) => provider(context));
}

function isExtensionToolsRequest(value: unknown): value is ExtensionToolsRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"add" in value &&
			typeof value.add === "function",
	);
}
