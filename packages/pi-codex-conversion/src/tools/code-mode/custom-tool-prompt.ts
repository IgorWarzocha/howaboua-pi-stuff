import type {
	CodeModeToolDefinition,
	CodeModeToolMetadata,
	CustomToolDefinition,
} from "./types.js";
import type { CodeModeExecutionKind } from "./shared-runtime.js";
import {
	translateCodeModeGuideline,
	translateCodeModeToolReferences,
	translateCodeModeUsage,
} from "./tool-identity.ts";

export const EXEC_DESCRIPTION = `Run JavaScript to compose tools; source only, no JSON or fences
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults 30000 ms/10000 tokens
Await work; bare values are discarded; globals: tools, image, generatedImage, store, load, exit, setTimeout, clearTimeout, ALL_TOOLS; text(value) serializes output, notify(value) emits, yield_control() yields`;

export const WAIT_DESCRIPTION =
	"Resume or terminate a yielded exec cell";

const BUNDLED_TOOLS_HEADING = "Tools available in exec:";
const CUSTOM_TOOLS_HEADING = "Configured custom tools:";
const TOOL_GUIDANCE_HEADING = "Tool guidance:";
const DEFERRED_TOOLS_GUIDANCE = "For additional tools, run text(ALL_TOOLS) in exec";
const CUSTOM_TOOLS_GUIDANCE =
	"Prefer custom tools for command-backed capabilities";
export const CODE_MODE_TOOLS_SECTION = "exec_tools";

export interface CodeModeSystemPromptOptions {
	forceSystemPrompt?: string | undefined;
	sections?: Record<string, string> | undefined;
}

const customizationGuidance = new WeakMap<CodeModeSystemPromptOptions, () => string>();

export function codeModeCustomizationGuidance(options: CodeModeSystemPromptOptions): string {
	return customizationGuidance.get(options)?.() ?? "";
}

function isConfiguredCustomTool(
	tool: CodeModeToolDefinition,
): tool is CustomToolDefinition {
	return "command" in tool;
}

export function isDeferredDiscoverableTool(tool: CodeModeToolDefinition): boolean {
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
		tool.namespace?.instructions ? `Instructions: ${tool.namespace.instructions}` : undefined,
		"inputSchema" in tool && tool.inputSchema ? `Schema: ${formatSchema(tool.inputSchema)}` : undefined,
		tool.output ? `Output: ${tool.output}` : undefined,
		tool.annotations ? `Annotations: ${JSON.stringify(tool.annotations)}` : undefined,
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
	priority: readonly string[] = [],
): string {
	if (tools.length === 0) return "";
	return `${heading}\n${[...tools]
		.sort((left, right) => {
			const rank = (name: string) => {
				const index = priority.indexOf(name);
				return index === -1 ? priority.length : index;
			};
			return rank(left.name) - rank(right.name) || left.name.localeCompare(right.name);
		})
		.map((tool) => `- ${translateCodeModeUsage(tool.usage, tool.name)}`)
		.join("\n")}`;
}

export function buildCodeModeToolsPrompt(
	tools: CodeModeToolDefinition[],
	executionKind: CodeModeExecutionKind = "code",
): string {
	const bundled = tools.filter(
		(tool) => !isConfiguredCustomTool(tool) && !tool.deferLoading,
	);
	const custom = tools.filter(isConfiguredCustomTool);
	const promotedCustom = custom.filter((tool) => !tool.deferLoading);
	const sections = [
		executionKind === "notebook"
			? "exec is a persistent Deno/TypeScript notebook with console, imports, npm, Deno, and Web APIs; globals may come from earlier agents and sessions. Build small programs on retained state across cells"
			: "exec runs fresh restricted JavaScript; no console, imports, Node, or browser APIs",
		buildUsageSection(BUNDLED_TOOLS_HEADING, bundled, [
			"exec_command", "write_stdin", "apply_patch", "view_image",
			"change_reasoning", "get_context_remaining",
		]),
		buildUsageSection(CUSTOM_TOOLS_HEADING, promotedCustom),
		buildGuidanceSection(tools),
		tools.some(isDeferredDiscoverableTool) ? DEFERRED_TOOLS_GUIDANCE : undefined,
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
	executionKind: CodeModeExecutionKind = "code",
): string {
	const sections = options.sections ??= {};
	customizationGuidance.set(options, () => documentationPath && isEnabled()
		? `Custom tools to run in exec: read ${documentationPath} instead of Pi docs`
		: "");
	const section = buildCodeModeToolsPrompt(tools, executionKind);
	if (options.forceSystemPrompt !== undefined) {
		options.forceSystemPrompt = upsertCodeModeToolsSection(options.forceSystemPrompt, isEnabled() ? section : "");
	} else {
		defineCodeModeToolsSection(sections, section, isEnabled);
	}
	return section;
}
