import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../code-mode/custom-tool-prompt.ts";
import { codeModeGlobalName, resolveCodeModeToolIdentity } from "../code-mode/tool-identity.ts";
import type { CodeModeToolDefinition } from "../code-mode/types.ts";

export function notebookCellSource(id: string, code: string, tools: CodeModeToolDefinition[]): string {
	const metadata = tools
		.filter(isCodeModeToolDiscoverable)
		.map((tool) => ({
			name: codeModeGlobalName(tool.name),
			description: formatCodeModeToolHelp(tool),
		}));
	const toolNames = Object.fromEntries(tools.map((tool) => [
		codeModeGlobalName(tool.name),
		resolveCodeModeToolIdentity(tool),
	]));
	const outputHints = Object.fromEntries(tools.flatMap((tool) =>
		"textOutput" in tool && tool.textOutput !== undefined
			? [[codeModeGlobalName(tool.name), tool.textOutput]]
			: []));
	return [
		`if (typeof globalThis.__piNotebook?.begin !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.begin");`,
		`await globalThis.__piNotebook.begin(${JSON.stringify(id)}, ${JSON.stringify(metadata)}, ${JSON.stringify(toolNames)}, ${JSON.stringify(outputHints)});`,
		code,
		`if (typeof globalThis.__piNotebook?.flush !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.flush");`,
		`await globalThis.__piNotebook.flush(${JSON.stringify(id)});`,
		"undefined;",
	].join("\n");
}
