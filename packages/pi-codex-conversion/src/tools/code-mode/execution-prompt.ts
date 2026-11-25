import {
	defineOwnedSection,
	upsertOpaqueSection,
} from "../../prompt/owned-sections.ts";
import type { CodeModeToolDefinition, CustomToolDefinition } from "./types.js";
import type { CodeModeExecutionKind } from "../execution/runtime.js";
import {
	codeModeGlobalName,
	translateCodeModeGuideline,
	translateCodeModeToolReferences,
	translateCodeModeUsage,
} from "./tool-identity.ts";

const BUNDLED_TOOLS_HEADING = "Tools available in exec:";
const CUSTOM_TOOLS_HEADING = "Configured custom tools:";
const CUSTOM_TOOLS_GUIDANCE =
	"Prefer custom tools for command-backed capabilities";
export const CODE_MODE_TOOLS_SECTION = "exec_tools";

export interface CodeModeSystemPromptOptions {
	forceSystemPrompt?: string | undefined;
	sections?: Record<string, string> | undefined;
}

interface CodeModePromptCapture {
	toolNames: readonly string[];
	customizationGuidance(): string;
}

const promptCaptures = new WeakMap<
	CodeModeSystemPromptOptions,
	CodeModePromptCapture
>();

export function getCodeModePromptCapture(
	options: CodeModeSystemPromptOptions,
): CodeModePromptCapture | undefined {
	return promptCaptures.get(options);
}

function isConfiguredCustomTool(
	tool: CodeModeToolDefinition,
): tool is CustomToolDefinition {
	return "command" in tool;
}

export function isCodeModeToolListed(tool: CodeModeToolDefinition): boolean {
	return !(
		"invoke" in tool &&
		tool.deferLoading &&
		tool.discoverWhenDeferred === false
	);
}

export function formatCodeModeToolHelp(tool: CodeModeToolDefinition): string {
	return [
		`Usage: ${translateCodeModeUsage("discoveryUsage" in tool && tool.discoveryUsage ? tool.discoveryUsage : tool.usage, tool.name)}`,
		tool.description
			? translateCodeModeToolReferences(tool.description, tool.name)
			: undefined,
		tool.promptSnippet
			? translateCodeModeToolReferences(tool.promptSnippet, tool.name)
			: undefined,
		...(tool.promptGuidelines ?? []).map((guideline) =>
			translateCodeModeGuideline(guideline, tool.name),
		),
		tool.namespace?.instructions
			? `Instructions: ${tool.namespace.instructions}`
			: undefined,
		isConfiguredCustomTool(tool)
			? 'Schema: {"type":"string"}'
			: "inputSchema" in tool && tool.inputSchema
				? `Schema: ${formatSchema(tool.inputSchema)}`
				: undefined,
		tool.output ? `Output: ${tool.output}` : undefined,
		tool.annotations
			? `Annotations: ${JSON.stringify(tool.annotations)}`
			: undefined,
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

function hasUsageCall(tool: CodeModeToolDefinition): boolean {
	return "discovery" in tool && tool.discovery === "help";
}

function renderStandingTool(tool: CodeModeToolDefinition): string[] {
	const name = codeModeGlobalName(tool.name);
	const binding = `tools.${name}`;
	const help = hasUsageCall(tool);
	const description = translateCodeModeToolReferences(
		tool.description ?? "",
		tool.name,
	).trim();
	const usage = translateCodeModeUsage(tool.usage, tool.name);
	const call = usage.startsWith(`${binding}(`) ? usage : undefined;
	const entry = help
		? `- ${binding}()${description ? `: ${description}` : ""}`
		: call
			? `- ${call}${description ? `; ${description}` : ""}`
			: `- ${binding}: ${[description, `Usage: ${usage}`].filter(Boolean).join("; ")}`;
	if (!("invoke" in tool) || tool.translatePromptMetadata !== true)
		return [entry];
	const labels = [binding, name, tool.name, tool.topLevelName];
	return [
		entry,
		...(tool.promptGuidelines ?? []).map((guideline) => {
			const translated = translateCodeModeGuideline(guideline, tool.name);
			const label = labels.find(
				(label) => label && translated.startsWith(`${label}:`),
			);
			const rule = label
				? translated.slice(label.length + 1).trimStart()
				: translated;
			return `- ${binding}: ${rule}`;
		}),
	];
}

function buildUsageSection(
	heading: string,
	tools: CodeModeToolDefinition[],
	priority: readonly string[] = [],
): string {
	if (tools.length === 0) return "";
	return `${heading}\n${[...tools]
		.sort((left, right) => {
			const rank = (name: string) => {
				const index = priority.indexOf(name);
				return index === -1 ? priority.length : index;
			};
			return (
				rank(left.name) - rank(right.name) ||
				left.name.localeCompare(right.name)
			);
		})
		.flatMap(renderStandingTool)
		.join("\n")}`;
}

export function buildCodeModeToolsPrompt(
	tools: CodeModeToolDefinition[],
	executionKind: CodeModeExecutionKind = "code",
	heavySystemPromptOverwrite = false,
): string {
	const bundled = tools.filter(
		(tool) => !isConfiguredCustomTool(tool) && !tool.deferLoading,
	);
	const custom = tools.filter(isConfiguredCustomTool);
	const promotedCustom = custom.filter((tool) => !tool.deferLoading);
	const usageCalls = bundled.filter(hasUsageCall);
	const prose = (plain: string, compact: string) =>
		heavySystemPromptOverwrite ? compact : plain;
	const sections = [
		executionKind === "vm"
			? prose(
					"exec uses one JavaScript context for the conversation. Top-level declarations persist across cells and retain their values. Node, imports, fetch, and timers are unavailable. A stall, cancellation, memory limit, or termination clears bindings.",
					"exec=one JS context per conversation; top-level declarations and values persist across cells; no Node/imports/fetch/timers; stall/cancel/memory limit/termination clears bindings",
				)
			: executionKind === "ts"
				? prose(
						"exec runs TypeScript with persistent bindings, values, and modules across cells. Imports, npm, Node, and Web APIs are available.",
						"exec=persistent TS; bindings/values/modules persist across cells; imports/npm/Node/Web APIs available",
					)
				: prose(
						"Each exec call runs in a fresh JavaScript context without console, imports, Node, or browser APIs.",
						"exec=fresh restricted JS; no console/imports/Node/browser APIs",
					),
		executionKind !== "code"
			? prose(
					"One-off declarations MUST stay inside { ... }. Reserve top-level bindings for reuse across cells. For results you will replace, declare a descriptive let once, then assign without redeclaring.",
					"One-off declarations MUST stay in { ... }. Top level: cross-cell reuse only. Replaceable result→descriptive let once, then assign without let.",
				)
			: undefined,
		executionKind === "ts"
			? prose(
					"The entire cell, including tool arguments, is checked strictly. A type error prevents execution.",
					"Strict check: entire cell, including tool args. Type error→no execution",
				)
			: undefined,
		"Do not add decorative backticks to text in tool calls.",
		buildUsageSection(
			BUNDLED_TOOLS_HEADING,
			bundled.filter((tool) => !hasUsageCall(tool)),
			[
				"exec_command",
				"write_stdin",
				"apply_patch",
				"view_image",
				"change_reasoning",
				"get_context_remaining",
			],
		),
		buildUsageSection(
			heavySystemPromptOverwrite
				? "Usage calls below. MUST NOT guess args. Unknown args→call for usage first, separately; known args→call directly"
				: "These calls show usage. MUST NOT guess arguments. If you don't know the current arguments, call for usage separately before the operation. If you know them, call the operation directly.",
			usageCalls,
		),
		buildUsageSection(CUSTOM_TOOLS_HEADING, promotedCustom),
		// The catalogue is always available, even when its first or last tool is unlisted.
		prose(
			"List tool names with text(ALL_TOOLS.map(t=>t.name)). Look up a tool contract with text(ALL_TOOLS.find(t=>t.name==='NAME')).",
			"Tool names→text(ALL_TOOLS.map(t=>t.name)); contract→text(ALL_TOOLS.find(t=>t.name==='NAME'))",
		),
		custom.length > 0
			? prose(`${CUSTOM_TOOLS_GUIDANCE}.`, CUSTOM_TOOLS_GUIDANCE)
			: undefined,
	].filter(Boolean);
	return sections.join("\n");
}

export function prepareCodeModeToolsPrompt(
	options: CodeModeSystemPromptOptions,
	tools: CodeModeToolDefinition[],
	documentationPath?: string,
	isEnabled: () => boolean = () => true,
	executionKind: CodeModeExecutionKind = "code",
	heavySystemPromptOverwrite = false,
): string {
	const sections = (options.sections ??= {});
	// Share this turn's canonical snapshot, not the changing live catalogue.
	promptCaptures.set(options, {
		toolNames: tools.map((tool) => tool.name),
		customizationGuidance: () =>
			documentationPath && isEnabled()
				? heavySystemPromptOverwrite
					? `exec custom tools→read ${documentationPath}, not Pi docs`
					: `For exec custom tools, read ${documentationPath} instead of the Pi documentation.`
				: "",
	});
	const section = buildCodeModeToolsPrompt(
		tools,
		executionKind,
		heavySystemPromptOverwrite,
	);
	if (options.forceSystemPrompt !== undefined) {
		options.forceSystemPrompt = upsertOpaqueSection(
			options.forceSystemPrompt,
			CODE_MODE_TOOLS_SECTION,
			isEnabled() ? section : "",
		);
	} else {
		defineOwnedSection(sections, CODE_MODE_TOOLS_SECTION, () =>
			isEnabled() ? section : "",
		);
	}
	return section;
}
