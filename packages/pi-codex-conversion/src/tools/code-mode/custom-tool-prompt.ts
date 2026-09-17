import type {
	CodeModeToolDefinition,
	CodeModeToolMetadata,
	CustomToolDefinition,
} from "./types.js";
import {
	translateCodeModeGuideline,
	translateCodeModeToolReferences,
	translateCodeModeUsage,
} from "./tool-identity.ts";

export const EXEC_DESCRIPTION = `Run JavaScript to compose tools; source only, no JSON or fences
Runtime follows the selected mode: Code is fresh restricted JS with no console/imports/Node/browser APIs; Notebook is one persistent Deno TypeScript global environment shared by every exec call, with console, imports, npm, Deno, and Web APIs
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults 30000 ms/10000 tokens
Await work; bare values are discarded; globals: tools, image, generatedImage, store, load, exit, setTimeout, clearTimeout, ALL_TOOLS; text(value) serializes output, notify(value) emits, yield_control() yields`;

export const WAIT_DESCRIPTION =
	"Resume or terminate a yielded exec cell";

const BUNDLED_TOOLS_HEADING = "Tools available in exec:";
const CUSTOM_TOOLS_HEADING = "Configured custom tools:";
const TOOL_GUIDANCE_HEADING = "Tool guidance:";
const DEFERRED_TOOLS_GUIDANCE = "ALL_TOOLS lists deferred tools only; other callable tools are advertised above";
const CUSTOM_TOOL_DOCUMENTATION_MARKER = "To create or edit a custom tool, read";
const CUSTOM_TOOL_DOCUMENTATION_GUIDANCE = "Never read that file to discover or call tools";
const CUSTOM_TOOLS_GUIDANCE =
	"Prefer custom tools for command-backed capabilities";
export const CODE_MODE_TOOLS_SECTION = "codex_tools";

export interface CodeModeSystemPromptOptions {
	forceSystemPrompt?: string | undefined;
	sections?: Record<string, string> | undefined;
}

function isConfiguredCustomTool(
	tool: CodeModeToolDefinition,
): tool is CustomToolDefinition {
	return "command" in tool;
}

function isDeferredDiscoverableTool(tool: CodeModeToolDefinition): boolean {
	return tool.deferLoading &&
		(isConfiguredCustomTool(tool) || ("invoke" in tool && tool.discoverWhenDeferred === true));
}

export function formatCodeModeToolHelp(tool: CodeModeToolDefinition): string {
	return [
		`Usage: ${translateCodeModeUsage(tool.usage, tool.name)}`,
		tool.description
			? translateCodeModeToolReferences(tool.description, tool.name)
			: undefined,
		tool.promptSnippet
			? translateCodeModeToolReferences(tool.promptSnippet, tool.name)
			: undefined,
		...(tool.promptGuidelines ?? []).map((guideline) =>
			translateCodeModeGuideline(guideline, tool.name)),
		"inputSchema" in tool && tool.inputSchema ? `Schema: ${formatSchema(tool.inputSchema)}` : undefined,
		tool.output ? `Output: ${tool.output}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

function formatSchema(schema: unknown): string {
	try {
		return JSON.stringify(schema);
	} catch {
		return "[unavailable schema]";
	}
}

function translatedPromptLines(tool: CodeModeToolDefinition): string[] {
	if (!("invoke" in tool) || tool.translatePromptMetadata !== true) return [];
	// Usage owns the callable contract here; native descriptions and schemas do not.
	return (tool.promptGuidelines ?? []).map((guideline) =>
		`- ${translateCodeModeGuideline(guideline, tool.name)}`);
}

function buildGuidanceSection(tools: CodeModeToolDefinition[]): string {
	const lines = tools
		.filter((tool) => !tool.deferLoading)
		.flatMap(translatedPromptLines);
	return lines.length ? `${TOOL_GUIDANCE_HEADING}\n${lines.join("\n")}` : "";
}

function buildUsageSection(
	heading: string,
	tools: CodeModeToolMetadata[],
): string {
	if (tools.length === 0) return "";
	return `${heading}\n${[...tools]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((tool) => `- ${translateCodeModeUsage(tool.usage, tool.name)}`)
		.join("\n")}`;
}

export function buildCodeModeToolsPrompt(
	tools: CodeModeToolDefinition[],
	documentationPath?: string,
): string {
	const bundled = tools.filter(
		(tool) => !isConfiguredCustomTool(tool) && !tool.deferLoading,
	);
	const custom = tools.filter(isConfiguredCustomTool);
	const promotedCustom = custom.filter((tool) => !tool.deferLoading);
	const sections = [
		buildUsageSection(BUNDLED_TOOLS_HEADING, bundled),
		buildUsageSection(CUSTOM_TOOLS_HEADING, promotedCustom),
		buildGuidanceSection(tools),
		tools.some(isDeferredDiscoverableTool) ? DEFERRED_TOOLS_GUIDANCE : undefined,
		documentationPath
			? `${CUSTOM_TOOL_DOCUMENTATION_MARKER} ${documentationPath}; do not read Pi docs\n${CUSTOM_TOOL_DOCUMENTATION_GUIDANCE}`
			: undefined,
		custom.length > 0 ? CUSTOM_TOOLS_GUIDANCE : undefined,
	].filter(Boolean);
	return sections.join("\n");
}

function upsertCodeModeToolsSection(systemPrompt: string, section: string): string {
	const open = `<${CODE_MODE_TOOLS_SECTION}>`;
	const close = `</${CODE_MODE_TOOLS_SECTION}>`;
	const start = systemPrompt.indexOf(open);
	const end = start === -1 ? -1 : systemPrompt.indexOf(close, start + open.length);
	if (start !== -1 && end !== -1) {
		const after = end + close.length;
		if (!section) return `${systemPrompt.slice(0, start)}${systemPrompt.slice(after)}`.replace(/\n{3,}/g, "\n\n").trim();
		return `${systemPrompt.slice(0, start)}${open}\n${section}\n${close}${systemPrompt.slice(after)}`;
	}
	if (!section) return systemPrompt;
	return `${systemPrompt.trimEnd()}\n\n${open}\n${section}\n${close}`;
}

function defineCodeModeToolsSection(
	sections: Record<string, string>,
	section: string,
	isEnabled: () => boolean,
): void {
	let override: string | undefined;
	Object.defineProperty(sections, CODE_MODE_TOOLS_SECTION, {
		configurable: true,
		enumerable: true,
		get: () => override ?? (isEnabled() ? section : ""),
		set: (value: string) => {
			override = value;
		},
	});
}

export function prepareCodeModeToolsPrompt(
	options: CodeModeSystemPromptOptions,
	tools: CodeModeToolDefinition[],
	documentationPath?: string,
	isEnabled: () => boolean = () => true,
): string {
	const sections = options.sections ??= {};
	const section = buildCodeModeToolsPrompt(tools, documentationPath);
	if (options.forceSystemPrompt !== undefined) {
		options.forceSystemPrompt = upsertCodeModeToolsSection(options.forceSystemPrompt, isEnabled() ? section : "");
	} else if (section) {
		defineCodeModeToolsSection(sections, section, isEnabled);
	} else {
		delete sections[CODE_MODE_TOOLS_SECTION];
	}
	return section;
}
