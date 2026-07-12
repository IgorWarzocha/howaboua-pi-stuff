export const STATUS_KEY = "codex-adapter";
export const STATUS_TEXT = "Codex adapter";

interface StatusTheme {
	fg(role: string, text: string): string;
}

function formatStatusText(suffix: string, theme?: StatusTheme | undefined): string {
	if (!theme) return `${STATUS_TEXT}${suffix}`;
	return `${theme.fg("accent", STATUS_TEXT)}${suffix ? theme.fg("dim", suffix) : ""}`;
}

export function buildExtraToolsOnlyStatusText(tools: string[], theme?: StatusTheme | undefined): string {
	return formatStatusText(` • extra tools${tools.length > 0 ? `: ${tools.join(", ")}` : ""}`, theme);
}

export function buildStatusText(options: { mode?: "normal" | "path" | "code" | undefined; verbosity?: string | undefined; webSearch?: boolean | undefined; imageGeneration?: boolean | undefined; fast: boolean; useOnAllModels: boolean; additionalProvider?: boolean | undefined; compaction?: { enabled: boolean; model: string; reasoning: string } | undefined }, theme?: StatusTheme | undefined): string {
	const extras = [
		options.mode === "path" ? "PATH mode" : undefined,
		options.mode === "code" ? "code mode" : undefined,
		options.useOnAllModels ? "all models" : undefined,
		options.additionalProvider ? "additional provider" : undefined,
		options.webSearch ? "web search" : undefined,
		options.imageGeneration ? "image gen" : undefined,
		options.compaction?.enabled ? `compact ${options.compaction.model}/${options.compaction.reasoning}` : undefined,
		options.fast ? "fast" : undefined,
	]
		.filter(Boolean)
		.join(" • ");
	const verbosity = options.verbosity === "medium" ? "mid" : options.verbosity === "high" ? "hi" : options.verbosity;
	return formatStatusText(`${verbosity ? ` V: ${verbosity}` : ""}${extras ? ` • ${extras}` : ""}`, theme);
}

export const DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"];

export const SHELL_ADAPTER_TOOL_NAMES = ["exec_command", "write_stdin"];
export const APPLY_PATCH_TOOL_NAME = "apply_patch";
export const CORE_ADAPTER_TOOL_NAMES = [...SHELL_ADAPTER_TOOL_NAMES, APPLY_PATCH_TOOL_NAME];
export const PATH_MODE_TOOL_NAMES = [...SHELL_ADAPTER_TOOL_NAMES];
export const CODE_MODE_TOOL_NAMES = ["exec", "wait"];
export const IMAGE_GENERATION_TOOL_NAME = "imagegen";
export const VIEW_IMAGE_TOOL_NAME = "view_image";
export const WEB_SEARCH_TOOL_NAME = "web_run";
