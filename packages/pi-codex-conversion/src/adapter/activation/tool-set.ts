import type { CodexUsageStatus } from "../../codex-usage/payload.ts";
import { EXECUTION_MODE_LABELS, type ExecutionMode } from "./execution-mode.ts";
import type { AdapterState } from "./state.ts";

export const STATUS_KEY = "codex-adapter";
export const STATUS_TEXT = "Codex adapter";

interface StatusTheme {
	fg(role: string, text: string): string;
}

function formatStatusText(
	suffix: string,
	theme?: StatusTheme | undefined,
): string {
	if (!theme) return `${STATUS_TEXT}${suffix}`;
	return `${theme.fg("accent", STATUS_TEXT)}${suffix ? theme.fg("dim", suffix) : ""}`;
}

export function buildStatusText(
	options: {
		executionMode?: ExecutionMode | undefined;
		verbosity?: string | undefined;
		fast: "priority" | "ultrafast" | undefined;
		baseTierEstimate?: boolean | undefined;
		daybreak?: boolean | undefined;
		useOnAllModels: boolean;
		configuredResponsesModel?: boolean | undefined;
		compaction?: boolean | undefined;
		usageStatus?: CodexUsageStatus | undefined;
	},
	theme?: StatusTheme | undefined,
): string {
	const extras = [
		options.executionMode
			? EXECUTION_MODE_LABELS[options.executionMode]
			: undefined,
		options.useOnAllModels ? "all models" : undefined,
		options.configuredResponsesModel ? "configured model" : undefined,
		options.compaction ? "compact v2" : undefined,
		options.fast === "ultrafast"
			? "ultrafast"
			: options.fast
				? "fast"
				: undefined,
		options.baseTierEstimate ? "base cost estimate" : undefined,
		options.daybreak ? "Daybreak" : undefined,
		options.usageStatus?.fiveHourUsageLeft === undefined
			? undefined
			: `5h: ${Math.round(options.usageStatus.fiveHourUsageLeft)}% left`,
		options.usageStatus?.weeklyUsageLeft === undefined
			? undefined
			: `weekly: ${Math.round(options.usageStatus.weeklyUsageLeft)}% left`,
	]
		.filter(Boolean)
		.join(" • ");
	const verbosity =
		options.verbosity === "medium"
			? "mid"
			: options.verbosity === "high"
				? "hi"
				: options.verbosity;
	return formatStatusText(
		`${verbosity ? ` V: ${verbosity}` : ""}${extras ? ` • ${extras}` : ""}`,
		theme,
	);
}

export const REPLACED_PI_TOOL_NAMES = ["read", "bash", "edit", "write"];

export const SHELL_ADAPTER_TOOL_NAMES = ["exec_command", "write_stdin"];
export const APPLY_PATCH_TOOL_NAME = "apply_patch";
export const CORE_ADAPTER_TOOL_NAMES = [
	...SHELL_ADAPTER_TOOL_NAMES,
	APPLY_PATCH_TOOL_NAME,
];
export const EXEC_TOOL_NAMES = ["exec", "wait"];
export const TS_NOTEBOOK_TOOL_NAMES = [...EXEC_TOOL_NAMES, "notebook"];
export const VIEW_IMAGE_TOOL_NAME = "view_image";
export const NESTED_ADAPTER_TOOL_NAMES = [
	...CORE_ADAPTER_TOOL_NAMES,
	VIEW_IMAGE_TOOL_NAME,
	"change_reasoning",
];

export function hiddenCodeModeToolNames(
	state: AdapterState,
	active: readonly string[],
): readonly string[] {
	return hasActiveExecTools(state.appliedRuntimeKind, active)
		? (state.hiddenCodeModeToolNames ?? [])
		: [];
}

export function hasActiveExecTools(
	kind: ExecutionMode | "inactive" | undefined,
	active: readonly string[],
): boolean {
	if (kind !== "code" && kind !== "vm" && kind !== "ts") return false;
	const required = kind === "ts" ? TS_NOTEBOOK_TOOL_NAMES : EXEC_TOOL_NAMES;
	return required.every((name) => active.includes(name));
}
