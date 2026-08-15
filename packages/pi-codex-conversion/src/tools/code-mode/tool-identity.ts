import type { CodeModeToolDefinition, CodeModeToolIdentity } from "./types.ts";

const DEFAULT_TOOL_NAMESPACE = "functions";

export function resolveCodeModeToolIdentity(tool: CodeModeToolDefinition): CodeModeToolIdentity {
	return tool.toolName ?? { name: tool.name };
}

export function codeModeNameForToolIdentity(identity: CodeModeToolIdentity): string {
	const namespace = identity.namespace;
	if (!namespace || namespace === DEFAULT_TOOL_NAMESPACE) return identity.name;
	return namespace.endsWith("_") || identity.name.startsWith("_")
		? `${namespace}${identity.name}`
		: `${namespace}__${identity.name}`;
}
