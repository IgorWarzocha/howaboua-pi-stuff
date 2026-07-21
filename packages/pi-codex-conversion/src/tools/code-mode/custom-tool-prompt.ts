import type { CodeModeToolMetadata } from "./types.js";

export const EXEC_DESCRIPTION = `Run raw JavaScript to compose tool calls
Optional first line: // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}
Emit output with text(value); console is unavailable
Globals: tools, text, image, generatedImage, store, load, notify, yield_control, exit, setTimeout, clearTimeout, ALL_TOOLS`;

export const WAIT_DESCRIPTION =
	"Resume or terminate an exec cell; use tools.write_stdin for session_id";

const PROMOTED_TOOLS_HEADING = "Custom tools available in exec:";
const DOCUMENTATION_PREFIX = "Custom tools documentation: read ";
const CUSTOM_TOOLS_GUIDANCE =
	"Prefer a custom tool over a Pi extension for a command-backed capability";

export function formatCustomToolHelp(tool: CodeModeToolMetadata): string {
	return [
		`Usage: ${tool.usage}`,
		tool.description,
		tool.output ? `Output: ${tool.output}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

export function buildPromotedToolsPrompt(
	tools: CodeModeToolMetadata[],
): string {
	const promoted = tools
		.filter((tool) => !tool.deferLoading)
		.sort((left, right) => left.name.localeCompare(right.name));
	if (promoted.length === 0) return "";
	return `${PROMOTED_TOOLS_HEADING}\n${promoted
		.map((tool) => `- ${tool.usage}`)
		.join("\n")}`;
}

export function buildCustomToolsDocumentationPrompt(
	documentationPath: string,
): string {
	return `${DOCUMENTATION_PREFIX}${documentationPath} before adding, changing, or answering questions about custom tools.\n${CUSTOM_TOOLS_GUIDANCE}`;
}

export function injectCustomToolsPrompt(
	systemPrompt: string,
	tools: CodeModeToolMetadata[],
	documentationPath: string,
): string {
	if (systemPrompt.includes(DOCUMENTATION_PREFIX)) return systemPrompt;
	const sections = [
		buildCustomToolsDocumentationPrompt(documentationPath),
		buildPromotedToolsPrompt(tools),
	].filter(Boolean);
	const section = sections.join("\n");
	const markers = ["\nCurrent shell:", "\nCurrent date:"]
		.map((marker) => systemPrompt.indexOf(marker))
		.filter((index) => index !== -1);
	const insertAt =
		markers.length > 0 ? Math.min(...markers) : systemPrompt.length;
	return `${systemPrompt.slice(0, insertAt).trimEnd()}\n\n${section}${systemPrompt.slice(insertAt)}`;
}
