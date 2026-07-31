import type {
	CodeModeToolDefinition,
	CodeModeToolMetadata,
	CustomToolDefinition,
} from "./types.js";

export const EXEC_DESCRIPTION = `Run JavaScript to compose tools; source only, no JSON or fences
Use tools for I/O; no console, imports, Node, or browser APIs
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults 30000 ms/10000 tokens
Await work; bare values are discarded; globals: tools, image, generatedImage, store, load, exit, setTimeout, clearTimeout, ALL_TOOLS; text(value) serializes output, notify(value) emits, yield_control() yields`;

export const WAIT_DESCRIPTION =
	"Resume or terminate a yielded exec cell";

const BUNDLED_TOOLS_HEADING = "Tools available in exec:";
const CUSTOM_TOOLS_HEADING = "Configured custom tools:";
const DEFERRED_CUSTOM_TOOLS_GUIDANCE = "Deferred custom tools: find by name in ALL_TOOLS";
const CUSTOM_TOOL_DOCUMENTATION_MARKER = "To create or edit a custom tool, read";
const CUSTOM_TOOL_DOCUMENTATION_GUIDANCE = "Never read that file to discover or call tools";
const CUSTOM_TOOLS_GUIDANCE =
	"Prefer custom tools for command-backed capabilities";

function isConfiguredCustomTool(
	tool: CodeModeToolDefinition,
): tool is CustomToolDefinition {
	return "command" in tool;
}

export function formatCodeModeToolHelp(tool: CodeModeToolMetadata): string {
	return [
		`Usage: ${tool.usage}`,
		tool.description,
		tool.output ? `Output: ${tool.output}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

function buildUsageSection(
	heading: string,
	tools: CodeModeToolMetadata[],
): string {
	if (tools.length === 0) return "";
	return `${heading}\n${[...tools]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((tool) => `- ${tool.usage}`)
		.join("\n")}`;
}

export function buildCodeModeToolsPrompt(
	tools: CodeModeToolDefinition[],
	documentationPath?: string,
	existingPrompt = "",
): string {
	const bundled = tools.filter(
		(tool) => !isConfiguredCustomTool(tool) && !tool.deferLoading,
	);
	const custom = tools.filter(isConfiguredCustomTool);
	const promotedCustom = custom.filter((tool) => !tool.deferLoading);
	const sections = [
		existingPrompt.includes(BUNDLED_TOOLS_HEADING)
			? undefined
			: buildUsageSection(BUNDLED_TOOLS_HEADING, bundled),
		existingPrompt.includes(CUSTOM_TOOLS_HEADING)
			? undefined
			: buildUsageSection(CUSTOM_TOOLS_HEADING, promotedCustom),
		custom.some((tool) => tool.deferLoading) && !existingPrompt.includes(DEFERRED_CUSTOM_TOOLS_GUIDANCE)
			? DEFERRED_CUSTOM_TOOLS_GUIDANCE
			: undefined,
		documentationPath && !existingPrompt.includes(CUSTOM_TOOL_DOCUMENTATION_MARKER)
			? `${CUSTOM_TOOL_DOCUMENTATION_MARKER} ${documentationPath}; do not read Pi docs\n${CUSTOM_TOOL_DOCUMENTATION_GUIDANCE}`
			: undefined,
		custom.length > 0 && !existingPrompt.includes(CUSTOM_TOOLS_GUIDANCE) ? CUSTOM_TOOLS_GUIDANCE : undefined,
	].filter(Boolean);
	return sections.join("\n");
}

export function injectCodeModeToolsPrompt(
	systemPrompt: string,
	tools: CodeModeToolDefinition[],
	documentationPath?: string,
): string {
	const section = buildCodeModeToolsPrompt(tools, documentationPath, systemPrompt);
	if (!section) return systemPrompt;
	const markers = ["\nCurrent shell:", "\nCurrent date:"]
		.map((marker) => systemPrompt.indexOf(marker))
		.filter((index) => index !== -1);
	const insertAt =
		markers.length > 0 ? Math.min(...markers) : systemPrompt.length;
	return `${systemPrompt.slice(0, insertAt).trimEnd()}\n\n${section}${systemPrompt.slice(insertAt)}`;
}

export function replaceCodeModeToolsPrompt(
	systemPrompt: string,
	previousSection: string | undefined,
	nextTools: CodeModeToolDefinition[],
	documentationPath?: string,
): { systemPrompt: string; section: string } {
	const hasPrevious = Boolean(previousSection && systemPrompt.includes(previousSection));
	const basePrompt = hasPrevious ? systemPrompt.replace(previousSection!, "") : systemPrompt;
	const section = buildCodeModeToolsPrompt(nextTools, documentationPath, basePrompt);
	return {
		systemPrompt: hasPrevious
			? systemPrompt.replace(previousSection!, section)
			: injectCodeModeToolsPrompt(systemPrompt, nextTools, documentationPath),
		section,
	};
}
