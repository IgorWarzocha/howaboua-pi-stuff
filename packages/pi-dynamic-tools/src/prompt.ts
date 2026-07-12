import type { DynamicToolDefinition } from "./types.js";

export const EXEC_DESCRIPTION = `Run JavaScript to compose dynamic tool calls.
- \`tools.<name>(input)\` takes one string and returns \`Promise<string>\`.
- Code runs as an async module in isolated V8: no Node, filesystem, network, or console. Await all work; unawaited promises are discarded.
- Optional first line: \`// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}\`. Defaults are 10000 ms and 10000 tokens. Set \`yield_time_ms\` near the expected runtime; use 60000 or more for subagents and long commands to avoid repeated waits. Long waits remain cancellable, and \`notify()\` still emits progress.

Helpers:
- \`text(value)\` appends output and JSON-stringifies non-strings; \`image(dataUrl, detail?)\` and \`generatedImage(result)\` append images.
- \`store(key, value)\` / \`load(key)\` share serializable values in this live session.
- \`notify(value)\` emits progress; \`yield_control()\` yields output while work continues; \`exit()\` ends successfully.
- \`setTimeout\` / \`clearTimeout\` manage timers; pending timers do not keep exec alive.
- \`ALL_TOOLS\` contains \`{ name, description }\` metadata.

All dynamic tools remain callable on \`tools\`. When a needed tool is unknown, search \`ALL_TOOLS\` by name or description. List names with \`text(ALL_TOOLS.map(({ name }) => name))\`; inspect one with \`text(ALL_TOOLS.find(({ name }) => name === "tool_name"))\`.`;

export const WAIT_DESCRIPTION =
	"Wait for new output or terminate a yielded exec cell. Prefer one long wait over repeated short waits: set yield_time_ms near the expected remaining runtime, using 60000 or more for long tasks. Long waits remain cancellable and notify progress remains visible. Returns only output since the previous yield; call wait again if still running.";

const PROMOTED_TOOLS_HEADING = "Dynamic tools available in exec:";
const DOCUMENTATION_PREFIX = "Dynamic tools documentation: read ";
const DYNAMIC_TOOLS_GUIDANCE =
	"Prefer a dynamic tool over a Pi extension for a command-backed capability.";

export function formatDynamicToolHelp(tool: DynamicToolDefinition): string {
	return [
		`Usage: ${tool.usage}`,
		tool.description,
		tool.output ? `Output: ${tool.output}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

export function buildPromotedToolsPrompt(
	tools: DynamicToolDefinition[],
): string {
	const promoted = tools
		.filter((tool) => !tool.deferLoading)
		.sort((left, right) => left.name.localeCompare(right.name));
	if (promoted.length === 0) return "";
	return `${PROMOTED_TOOLS_HEADING}\n${promoted
		.map((tool) => `- ${tool.name}: ${tool.usage}`)
		.join("\n")}`;
}

export function buildDynamicToolsDocumentationPrompt(
	documentationPath: string,
): string {
	return `${DOCUMENTATION_PREFIX}${documentationPath} before adding, changing, or answering questions about dynamic tools.\n${DYNAMIC_TOOLS_GUIDANCE}`;
}

export function injectDynamicToolsPrompt(
	systemPrompt: string,
	tools: DynamicToolDefinition[],
	documentationPath: string,
): string {
	if (systemPrompt.includes(DOCUMENTATION_PREFIX)) return systemPrompt;
	const sections = [
		buildDynamicToolsDocumentationPrompt(documentationPath),
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
