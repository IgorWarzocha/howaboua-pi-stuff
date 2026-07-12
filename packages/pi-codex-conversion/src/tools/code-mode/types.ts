import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type DynamicToolInputMode = "arg" | "stdin";

export interface CodeModeToolMetadata {
	name: string;
	usage: string;
	description?: string | undefined;
	output?: string | undefined;
	deferLoading: boolean;
}

export interface DynamicToolDefinition extends CodeModeToolMetadata {
	command: string;
	args: string[];
	input: DynamicToolInputMode;
	sourcePath: string;
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
}

export type CodeModeToolDefinition =
	| DynamicToolDefinition
	| ProgrammaticCodeModeToolDefinition;

export interface ToolExecutionContext {
	cwd: string;
	extensionContext?: ExtensionContext | undefined;
	onUpdate?:
		| ((result: {
				content: Array<{ type: "text"; text: string }>;
				details: unknown;
		  }) => void)
		| undefined;
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
) & { maxOutputTokens?: number | undefined };
