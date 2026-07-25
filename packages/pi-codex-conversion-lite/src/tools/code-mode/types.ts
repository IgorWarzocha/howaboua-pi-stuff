import type {
	AgentToolResult,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

export type CustomToolInputMode = "arg" | "stdin";

export interface CodeModeToolMetadata {
	name: string;
	usage: string;
	description?: string | undefined;
	output?: string | undefined;
	deferLoading: boolean;
}

export interface CustomToolDefinition extends CodeModeToolMetadata {
	command: string;
	args: string[];
	input: CustomToolInputMode;
	yieldTimeMs?: number | undefined;
	sourcePath: string;
	disabledReason?: string | undefined;
}

export interface ProgrammaticCodeModeToolDefinition
	extends CodeModeToolMetadata {
	kind: "function" | "freeform";
	inputSchema?: unknown;
	invoke(
		input: unknown,
		context: ToolExecutionContext,
		signal: AbortSignal,
	): Promise<unknown>;
	renderCall?(
		input: unknown,
		theme: CodeModeRenderTheme,
		context: CodeModeNestedRenderContext,
	): Component;
	renderResult?(
		result: RuntimeToolResult,
		options: { expanded: boolean; isPartial: boolean },
		theme: CodeModeRenderTheme,
		context: CodeModeNestedRenderContext,
	): Component;
}

export type CodeModeToolDefinition =
	| CustomToolDefinition
	| ProgrammaticCodeModeToolDefinition;

export interface ToolExecutionContext {
	cwd: string;
	toolCallId?: string | undefined;
	extensionContext?: ExtensionContext | undefined;
	onUpdate?: ((result: AgentToolResult<unknown>) => void) | undefined;
	captureResult?: ((result: RuntimeToolResult) => void) | undefined;
	refreshTrace?: (() => void) | undefined;
}

export interface CodeModeRenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

export interface CodeModeNestedRenderContext {
	toolCallId?: string | undefined;
	cwd?: string | undefined;
	expanded?: boolean | undefined;
	isError?: boolean | undefined;
	args?: unknown;
	invalidate?: (() => void) | undefined;
}

export interface RuntimeToolResult {
	content: Array<
		| { type: "text"; text: string }
		| { type: "image"; data: string; mimeType: string }
	>;
	details?: unknown;
}

export interface RuntimeToolTrace {
	id: string;
	name: string;
	input: unknown;
	status: "running" | "done" | "error";
	result?: RuntimeToolResult | undefined;
	error?: string | undefined;
}

export interface RuntimeContentItem {
	type: "input_text" | "input_image";
	text?: string;
	image_url?: string;
	detail?: "auto" | "low" | "high" | "original" | null;
}

export type RuntimeResponse = (
	| { kind: "yielded"; cellId: string; contentItems: RuntimeContentItem[] }
	| { kind: "terminated"; cellId: string; contentItems: RuntimeContentItem[] }
	| {
			kind: "result";
			cellId: string;
			contentItems: RuntimeContentItem[];
			errorText?: string | undefined;
	  }
) & {
	maxOutputTokens?: number | undefined;
	missingCell?: true | undefined;
	traces?: RuntimeToolTrace[] | undefined;
	droppedTraceCount?: number | undefined;
};
