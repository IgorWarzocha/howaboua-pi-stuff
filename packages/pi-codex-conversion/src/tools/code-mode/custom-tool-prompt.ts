import type { CodeModeToolDefinition, CustomToolDefinition } from "./types.js";
import type { CodeModeExecutionKind } from "./shared-runtime.js";
import {
	codeModeGlobalName,
	translateCodeModeGuideline,
	translateCodeModeToolReferences,
	translateCodeModeUsage,
} from "./tool-identity.ts";

const JS_CELL_DESCRIPTION =
	"JavaScript computation/tool calls; source ONLY, NO JSON/fences";

export const EXEC_DESCRIPTION = `${JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults=30000ms/10000tokens
Bare values discarded; globals: tools, image, generatedImage, store, load, exit, setTimeout, clearTimeout, ALL_TOOLS; content(value)→emit MCP text/images in order; text(value)→print serialized output; notify(value)→emit; both→undefined; yield_control()→yield`;

export const ISOLATED_EXEC_GUIDANCE =
	'Concurrent isolated: // @exec: {"isolated":true}; last checkpoint; shared vars unchanged';

export const VM_EXEC_DESCRIPTION = `${JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults=30000ms/10000tokens
Bare values discarded; globals: tools, text, image, notify, generatedImage, store, load, yield_control, exit, console, ALL_TOOLS
content(value)→emit MCP text/images in order`;

export const WAIT_DESCRIPTION = "Resume or terminate a yielded exec cell";

const BUNDLED_TOOLS_HEADING = "Tools available in exec:";
const CUSTOM_TOOLS_HEADING = "Configured custom tools:";
const CUSTOM_TOOLS_GUIDANCE =
	"Prefer custom tools for command-backed capabilities";
export const CODE_MODE_TOOLS_SECTION = "exec_tools";

export interface CodeModeSystemPromptOptions {
	forceSystemPrompt?: string | undefined;
	sections?: Record<string, string> | undefined;
}

const customizationGuidance = new WeakMap<
	CodeModeSystemPromptOptions,
	() => string
>();
const promptToolNames = new WeakMap<
	CodeModeSystemPromptOptions,
	readonly string[]
>();

export function codeModePromptToolNames(
	options: CodeModeSystemPromptOptions,
): readonly string[] {
	return promptToolNames.get(options) ?? [];
}

export function codeModeCustomizationGuidance(
	options: CodeModeSystemPromptOptions,
): string {
	return customizationGuidance.get(options)?.() ?? "";
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
	const capability =
		help &&
		name === "agents" &&
		description.endsWith("; {} lists action fields")
			? description.slice(0, -"; {} lists action fields".length)
			: description;
	const usage = translateCodeModeUsage(tool.usage, tool.name);
	const call = usage.startsWith(`${binding}(`) ? usage : undefined;
	const entry = help
		? `- ${binding}()${capability ? `: ${capability}` : ""}`
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
					"exec uses one JavaScript context for the conversation. let, const, function, and class declarations persist. Node, imports, fetch, and timers are unavailable. A stall, cancellation, memory limit, or termination clears bindings.",
					"exec=one JS context per conversation; let/const/function/class persist; no Node/imports/fetch/timers; stall/cancel/memory limit/termination clears bindings",
				)
			: executionKind === "ts"
				? prose(
						"exec runs TypeScript with persistent bindings and modules. Imports, npm, Node, and Web APIs are available.",
						"exec=persistent TS; imports/npm/Node/Web APIs; bindings/modules persist",
					)
				: prose(
						"Each exec call runs in a fresh JavaScript context without console, imports, Node, or browser APIs.",
						"exec=fresh restricted JS; no console/imports/Node/browser APIs",
					),
		executionKind !== "code"
			? prose(
					"Put one-off const and let declarations in a block. Keep them at the top level only if another cell needs them.",
					"One-off const/let→block; top-level only for reuse across cells",
				)
			: undefined,
		executionKind === "ts"
			? prose(
					"The entire cell, including tool arguments, is checked strictly. A type error prevents execution.",
					"Strict check: entire cell, including tool args. Type error→no execution",
				)
			: undefined,
		executionKind === "ts"
			? prose(
					'For Markdown or multiline text, join an array of quoted lines with "\\n". If you use a template literal, escape literal backticks and ${...}.',
					'Markdown/multiline text→quoted lines joined with "\\n"; escape literal backticks and ${...} in templates',
				)
			: undefined,
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

function upsertCodeModeToolsSection(
	systemPrompt: string,
	section: string,
): string {
	const open = `<${CODE_MODE_TOOLS_SECTION}>`;
	const close = `</${CODE_MODE_TOOLS_SECTION}>`;
	const start = systemPrompt.indexOf(open);
	const end =
		start === -1 ? -1 : systemPrompt.indexOf(close, start + open.length);
	if (start !== -1 && end !== -1) {
		const after = end + close.length;
		if (!section)
			return `${systemPrompt.slice(0, start)}${systemPrompt.slice(after)}`
				.replace(/\n{3,}/g, "\n\n")
				.trim();
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
	heavySystemPromptOverwrite = false,
): string {
	const sections = (options.sections ??= {});
	// Share this turn's canonical snapshot, not the changing live catalogue.
	promptToolNames.set(
		options,
		tools.map((tool) => tool.name),
	);
	customizationGuidance.set(options, () =>
		documentationPath && isEnabled()
			? heavySystemPromptOverwrite
				? `exec custom tools→read ${documentationPath}, not Pi docs`
				: `For exec custom tools, read ${documentationPath} instead of the Pi documentation.`
			: "",
	);
	const section = buildCodeModeToolsPrompt(
		tools,
		executionKind,
		heavySystemPromptOverwrite,
	);
	if (options.forceSystemPrompt !== undefined) {
		options.forceSystemPrompt = upsertCodeModeToolsSection(
			options.forceSystemPrompt,
			isEnabled() ? section : "",
		);
	} else {
		defineCodeModeToolsSection(sections, section, isEnabled);
	}
	return section;
}
