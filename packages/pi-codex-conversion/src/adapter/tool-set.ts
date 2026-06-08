export const STATUS_KEY = "codex-adapter";
export const STATUS_TEXT = "\u001b[38;2;0;76;255mCodex adapter\u001b[0m";

export function buildStatusText(options: { verbosity?: string | undefined; fast: boolean; useOnAllModels: boolean; additionalProvider?: boolean | undefined; compaction?: { enabled: boolean; model: string; reasoning: string } | undefined }): string {
	const extras = [
		options.useOnAllModels ? "all models" : undefined,
		options.additionalProvider ? "additional provider" : undefined,
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
export const CORE_ADAPTER_TOOL_NAMES = [...SHELL_ADAPTER_TOOL_NAMES];
