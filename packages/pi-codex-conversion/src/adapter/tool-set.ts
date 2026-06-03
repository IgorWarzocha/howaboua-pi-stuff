export const STATUS_KEY = "codex-adapter";
export const STATUS_TEXT = "\u001b[38;2;0;76;255mCodex adapter\u001b[0m";
export const APPLY_PATCH_ONLY_STATUS_TEXT = `${STATUS_TEXT} • apply patch only`;

export function buildStatusText(options: { verbosity?: string | undefined; webSearch: boolean; imageGeneration: boolean; fast: boolean; useOnAllModels: boolean; useAdapterProviders?: boolean | undefined; compaction?: { enabled: boolean; model: string; reasoning: string } | undefined }): string {
	const extras = [
		options.useOnAllModels ? "all models" : undefined,
		options.useAdapterProviders ? "codex proxy" : undefined,
		options.webSearch ? "web search" : undefined,
		options.imageGeneration ? "image gen" : undefined,
		options.compaction?.enabled ? `compact ${options.compaction.model}/${options.compaction.reasoning}` : undefined,
		options.fast ? "fast" : undefined,
	]
		.filter(Boolean)
		.join(" • ");
	const verbosity = options.verbosity === "medium" ? "mid" : options.verbosity === "high" ? "hi" : options.verbosity;
	return `${STATUS_TEXT}${verbosity ? ` V: ${verbosity}` : ""}${extras ? ` • ${extras}` : ""}`;
}

export const DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"];

export const SHELL_ADAPTER_TOOL_NAMES = ["exec_command", "write_stdin"];
export const APPLY_PATCH_TOOL_NAME = "apply_patch";
export const CORE_ADAPTER_TOOL_NAMES = [...SHELL_ADAPTER_TOOL_NAMES, APPLY_PATCH_TOOL_NAME];
export const IMAGE_GENERATION_TOOL_NAME = "image_generation";
export const VIEW_IMAGE_TOOL_NAME = "view_image";
export const WEB_SEARCH_TOOL_NAME = "web.run";
