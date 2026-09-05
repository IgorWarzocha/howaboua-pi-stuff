import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { NOTEBOOK_MODE_TOOL_NAMES } from "./adapter/activation/tool-set.ts";
import { codeModeGlobalName } from "./tools/code-mode/tool-identity.ts";
import type { ProgrammaticCodeModeToolDefinition } from "./tools/code-mode/types.ts";

const EXTENSION_TOOLS_CHANNEL =
	"@howaboua/pi-codex-conversion.extension-code-mode-tools/v1";
const EXTENSION_TOOLS_REFRESH_CHANNEL =
	"@howaboua/pi-codex-conversion.extension-code-mode-tools-refresh/v1";
const RESERVED_EXTENSION_TOOL_NAMES = new Set(NOTEBOOK_MODE_TOOL_NAMES);

export type CodeModeExtensionToolProvider = (
	context: ExtensionContext | undefined,
) => readonly ProgrammaticCodeModeToolDefinition[];

export interface CodeModeExtensionToolRegistrationOptions {
	isActive?(context: ExtensionContext | undefined): boolean;
}

export interface CodeModeExtensionToolRegistration {
	refresh(): void;
	unregister(): void;
}

interface ExtensionToolsRequest {
	context: ExtensionContext | undefined;
	refreshGates: boolean;
	add(provider: CodeModeExtensionToolProvider, active: boolean): void;
}

export function registerCodeModeExtensionTools(
	pi: ExtensionAPI,
	provider: CodeModeExtensionToolProvider,
	options: CodeModeExtensionToolRegistrationOptions = {},
): CodeModeExtensionToolRegistration {
	let active = options.isActive === undefined;
	const stopProvider = pi.events.on(EXTENSION_TOOLS_CHANNEL, (value) => {
		if (!isExtensionToolsRequest(value)) return;
		if (value.refreshGates)
			active = options.isActive?.(value.context) ?? true;
		value.add(provider, active);
	});
	const refresh = () => {
		pi.events.emit(EXTENSION_TOOLS_REFRESH_CHANNEL, undefined);
	};
	let registered = true;
	const unregister = () => {
		if (!registered) return;
		registered = false;
		stopProvider();
		refresh();
	};
	try {
		refresh();
	} catch (error) {
		registered = false;
		stopProvider();
		throw error;
	}
	return {
		refresh,
		unregister,
	};
}

export function onCodeModeExtensionToolsRefresh(
	pi: ExtensionAPI,
	handler: () => void,
): () => void {
	return pi.events.on(EXTENSION_TOOLS_REFRESH_CHANNEL, handler);
}

export function getCodeModeExtensionTools(
	pi: ExtensionAPI,
	context: ExtensionContext | undefined,
): ProgrammaticCodeModeToolDefinition[] {
	return getCodeModeExtensionToolSnapshot(pi, context).tools;
}

export function getCodeModeExtensionToolSnapshot(
	pi: ExtensionAPI,
	context: ExtensionContext | undefined,
	refreshGates = false,
): {
	tools: ProgrammaticCodeModeToolDefinition[];
	allToolNames: string[];
} {
	const providers: Array<{
		provider: CodeModeExtensionToolProvider;
		active: boolean;
	}> = [];
	pi.events.emit(EXTENSION_TOOLS_CHANNEL, {
		context,
		refreshGates,
		add(provider, active) {
			providers.push({ provider, active });
		},
	} satisfies ExtensionToolsRequest);
	const resolved = providers.map(({ provider, active }) => ({
		active,
		tools: provider(context),
	}));
	const allTools = resolved.flatMap(({ tools }) => tools);
	const registeredNames = new Set(pi.getAllTools().map((tool) => tool.name));
	for (const tool of allTools) {
		if (RESERVED_EXTENSION_TOOL_NAMES.has(codeModeGlobalName(tool.name)))
			throw new Error(`Reserved Code Mode extension tool name: ${tool.name}`);
	}
	return {
		tools: resolved
			.filter(({ active }) => active)
			.flatMap(({ tools }) => tools)
			.filter((tool) => tool.topLevelName === undefined || registeredNames.has(tool.topLevelName)),
		allToolNames: [
			...new Set(
				allTools.map((tool) => tool.topLevelName ?? tool.name),
			),
		],
	};
}

function isExtensionToolsRequest(value: unknown): value is ExtensionToolsRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"add" in value &&
			typeof value.add === "function" &&
			"refreshGates" in value &&
			typeof value.refreshGates === "boolean",
	);
}
