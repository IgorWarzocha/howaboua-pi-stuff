export type DynamicToolInputMode = "arg" | "stdin";

export interface DynamicToolDefinition {
	name: string;
	usage: string;
	description?: string | undefined;
	output?: string | undefined;
	deferLoading: boolean;
	command: string;
	args: string[];
	input: DynamicToolInputMode;
	yieldTimeMs?: number | undefined;
	sourcePath: string;
	disabledReason?: string | undefined;
}

export interface ToolExecutionContext {
	cwd: string;
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
