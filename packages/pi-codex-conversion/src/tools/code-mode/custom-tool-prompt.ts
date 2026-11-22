import type { CodeModeToolDefinition, CustomToolDefinition } from "./types.js";
import type { CodeModeExecutionKind } from "./shared-runtime.js";
import {
	codeModeGlobalName,
	translateCodeModeGuideline,
	translateCodeModeToolReferences,
	translateCodeModeUsage,
} from "./tool-identity.ts";

const JS_CELL_DESCRIPTION =
	"Run JavaScript to process data or call tools; source only, no JSON or fences";
const GPT_JS_CELL_DESCRIPTION =
	"JavaScript computation/tool calls; source ONLY, NO JSON/fences";

export const EXEC_DESCRIPTION = `${JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults 30000 ms/10000 tokens
Bare values are discarded; globals: tools, image, generatedImage, store, load, exit, setTimeout, clearTimeout, ALL_TOOLS; content(value) emits MCP text/images in order; text(value) prints serialized output; notify(value) emits; both return undefined; yield_control() yields`;

export const GPT_EXEC_DESCRIPTION = `${GPT_JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults=30000ms/10000tokens
Bare values discarded; globals: tools, image, generatedImage, store, load, exit, setTimeout, clearTimeout, ALL_TOOLS; content(value)→emit MCP text/images in order; text(value)→print serialized output; notify(value)→emit; both→undefined; yield_control()→yield`;

export const ISOLATED_EXEC_GUIDANCE =
	'For independent work while another cell runs, add "isolated":true to // @exec. Starts from last saved state; leaves shared variables unchanged';
export const GPT_ISOLATED_EXEC_GUIDANCE =
	'Concurrent isolated: // @exec: {"isolated":true}; last checkpoint; shared vars unchanged';

export const VM_EXEC_DESCRIPTION = `${JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults 30000 ms/10000 tokens
Put one-off const and let declarations inside { ... }. Top-level bindings persist
Bare values discarded; globals: tools, text, image, notify, generatedImage, store, load, yield_control, exit, console, ALL_TOOLS
content(value) emits MCP text/images in order
No Node, imports, fetch or timers
A stall, cancellation, memory limit or terminate drops conversation bindings`;

export const GPT_VM_EXEC_DESCRIPTION = `${GPT_JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults=30000ms/10000tokens
One-off const/let→{ ... }; top-level→persists
Bare values discarded; globals: tools, text, image, notify, generatedImage, store, load, yield_control, exit, console, ALL_TOOLS
content(value)→emit MCP text/images in order
NO Node/imports/fetch/timers
Stall/cancel/memory limit/terminate→bindings dropped; next exec fresh`;

export const JS_EXEC_DESCRIPTION = `${JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults 30000 ms/10000 tokens
Bare values discarded; globals: tools, text, image, notify, generatedImage, store, load, yield_control, exit, ALL_TOOLS
content(value) emits MCP text/images in order
No Node, imports, fetch, timers or TypeScript checking`;

export const GPT_JS_EXEC_DESCRIPTION = `${GPT_JS_CELL_DESCRIPTION}
Optional // @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}; defaults=30000ms/10000tokens
Bare values discarded; globals: tools, text, image, notify, generatedImage, store, load, yield_control, exit, ALL_TOOLS
content(value)→emit MCP text/images in order
NO Node/imports/fetch/timers/TSchecking`;

export const WAIT_DESCRIPTION = "Resume or terminate a yielded exec cell";

const BUNDLED_TOOLS_HEADING = "Tools available in exec:";
const CUSTOM_TOOLS_HEADING = "Configured custom tools:";
const DEFERRED_TOOLS_GUIDANCE =
	"For additional tools and their contracts, run text(ALL_TOOLS) in exec";
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

export function isCodeModeToolDiscoverable(
	tool: CodeModeToolDefinition,
): boolean {
	return (
		isConfiguredCustomTool(tool) ||
		(tool.deferLoading &&
			"invoke" in tool &&
			tool.discoverWhenDeferred === true)
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

function renderStandingTool(tool: CodeModeToolDefinition): string[] {
	const name = codeModeGlobalName(tool.name);
	const binding = `tools.${name}`;
	const description = translateCodeModeToolReferences(
		tool.description ?? "",
		tool.name,
	).trim();
	const help = "discovery" in tool && tool.discovery === "help";
	const usage = translateCodeModeUsage(tool.usage, tool.name);
	const call = usage.startsWith(`${binding}(`) ? usage : undefined;
	const entry = help
		? `- ${binding}: ${description ? `${description}; ` : ""}Usage: ()`
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
	gpt = false,
): string {
	const bundled = tools.filter(
		(tool) => !isConfiguredCustomTool(tool) && !tool.deferLoading,
	);
	const custom = tools.filter(isConfiguredCustomTool);
	const promotedCustom = custom.filter((tool) => !tool.deferLoading);
	const sections = [
		executionKind === "vm"
			? gpt
				? "exec=one JS context for this conversation; let/const/function/class persist; NO Node/imports/fetch/timers; stall/cancel/memory limit/terminate drops bindings"
				: "exec keeps one JavaScript context for this conversation. let, const, function and class persist. No Node, imports, fetch or timers. A stall, cancellation, memory limit or terminate drops those bindings"
			: executionKind === "js"
				? gpt
					? "exec=fresh QuickJS per call; max4 concurrent; store/load→conversation-local JSON, no disk persistence"
					: "exec runs fresh QuickJS per call, with up to four concurrent cells. store/load retain conversation-local JSON, not disk state"
				: executionKind === "ts"
					? gpt
						? "exec=persistent TS; imports/npm/Node/Web APIs; bindings/modules persist"
						: "exec is a persistent TypeScript kernel with imports, npm, Node and Web APIs; live bindings and module instances persist across cells"
					: gpt
						? "exec=fresh restricted JS; NO console/imports/Node/browser APIs"
						: "exec runs fresh restricted JavaScript; no console, imports, Node, or browser APIs",
		executionKind === "ts"
			? gpt
				? "Whole-cell strictcheck INCL toolargs; typeerror→NO execution"
				: "Strict typechecking covers the whole cell, including tool arguments. Any type error prevents cell execution"
			: undefined,
		executionKind === "ts"
			? gpt
				? 'Markdown/multiline text→ordinary quoted line arrays joined with "\\n"; template literals require escaping backticks and ${...}'
				: 'For Markdown or multiline text, use ordinary quoted line arrays joined with "\\n". Template literals require escaping backticks and ${...} to keep them literal'
			: undefined,
		gpt
			? "Usage: ()→empty call lists args. Unknown args→read usage separately before operation. Don't guess or repeat discovery for known args"
			: "Usage: () means call the tool with no arguments to see accepted arguments. Read usage in a separate call before composing an operation with unknown arguments. Do not guess or repeat discovery for known arguments",
		buildUsageSection(BUNDLED_TOOLS_HEADING, bundled, [
			"exec_command",
			"write_stdin",
			"apply_patch",
			"view_image",
			"change_reasoning",
			"get_context_remaining",
		]),
		buildUsageSection(CUSTOM_TOOLS_HEADING, promotedCustom),
		// The catalogue is always available, even when its first or last tool is unlisted.
		gpt ? "More tools/contracts→text(ALL_TOOLS)" : DEFERRED_TOOLS_GUIDANCE,
		custom.length > 0 ? CUSTOM_TOOLS_GUIDANCE : undefined,
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
	gpt = false,
): string {
	const sections = (options.sections ??= {});
	// Share this turn's canonical snapshot, not the changing live catalogue.
	promptToolNames.set(
		options,
		tools.map((tool) => tool.name),
	);
	customizationGuidance.set(options, () =>
		documentationPath && isEnabled()
			? gpt
				? `exec custom tools→read ${documentationPath}, NOT Pi docs`
				: `Custom tools to run in exec: read ${documentationPath} instead of Pi docs`
			: "",
	);
	const section = buildCodeModeToolsPrompt(tools, executionKind, gpt);
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
