import type {
	CodexPromptMode,
	PiSystemPromptOptions,
} from "./build-system-prompt.ts";

const PI_DEFAULT_GUIDELINES = new Set([
	"Use bash for file operations like ls, rg, find",
	"Be concise in your responses",
	"Show file paths clearly when working with files",
]);

const RUNTIME_IDENTITY_GUIDELINE = "Pi; Codex-native tools";
export const GENERAL_GUIDELINES = [
	"Own task to completion; resolve recoverable blockers, continue independent work",
	"Ask ONLY if missing info or authorization changes action; report genuine blockers",
	"Clear request→act, don't offer; implied correction→fix unless explanation only",
	"Don't invent blockers; distinguish real requirements from self-imposed precautions or limits",
	"State supported conclusions directly; caveats ONLY if they change answer/next action",
] as const;

const SHELL_GUIDELINE = "Shell→exec_command; largeoutput→sourcefilter";
const TTY_GUIDELINE = "tty=true ONLY for input/persistent processes";
const EDIT_GUIDELINE =
	"Text edits/creates/deletes/moves→apply_patch; oversized→split";
const CONCURRENCY_GUIDELINE = "Independent calls→parallel when practical";

const CODE_MODE_GUIDELINES = [
	"JS tool calls: bind complex strings first. Preserve literal ${...} and backticks in payloads. Check quotes, commas and closing delimiters before sending.",
	"Related calls→one JS cell; branch/loop on results; text()→outcome, blocker or decision needed",
];
const NOTEBOOK_SHELL_GUIDELINE =
	"Canonical artifacts→files; shell state across tools.exec_command→files/args";
const TS_MODE_GUIDELINES = [
	"MAY reuse verified globals",
	"Task done→clean up retained bindings",
	...CODE_MODE_GUIDELINES,
	"Manage state: notebook({})",
	NOTEBOOK_SHELL_GUIDELINE,
	"Normal cells→serial; error→inspect state BEFORE retry",
	"Restart→recreate reported unsaved values",
];
const VM_MODE_GUIDELINES = [
	"MAY reuse verified bindings",
	...CODE_MODE_GUIDELINES,
];

const CODE_MODE_REPLACED_GUIDELINES = new Set([
	TTY_GUIDELINE,
	EDIT_GUIDELINE,
	CONCURRENCY_GUIDELINE,
]);
const OBSOLETE_GUIDELINE =
	"Prefer the apply_patch tool; use shell apply_patch only when chaining edits with other shell steps";

const STATIC_CODEX_GUIDELINES_BY_KEY = new Map([
	...[
		RUNTIME_IDENTITY_GUIDELINE,
		...GENERAL_GUIDELINES,
		SHELL_GUIDELINE,
		...CODE_MODE_REPLACED_GUIDELINES,
		...CODE_MODE_GUIDELINES,
		...TS_MODE_GUIDELINES,
		...VM_MODE_GUIDELINES,
	].map((guideline) => [guideline, guideline] as const),
	["Use tty=true for dev servers, watchers, REPLs, and prompts", TTY_GUIDELINE],
	["Use tty=true for interactive commands", TTY_GUIDELINE],
]);

function withoutCosmeticTerminalPeriod(value: string): string {
	return value.endsWith(".") && !value.endsWith("..")
		? value.slice(0, -1)
		: value;
}

function buildCodexGuidelines(
	mode: CodexPromptMode,
	selectedTools: readonly string[],
	piPackageRoot?: string,
	nestedTools: readonly string[] = [],
): string[] {
	const active = new Set(selectedTools);
	const guidelines: string[] = [
		RUNTIME_IDENTITY_GUIDELINE,
		...GENERAL_GUIDELINES,
	];
	if (mode === "normal") {
		if (active.has("exec_command"))
			guidelines.push(SHELL_GUIDELINE, TTY_GUIDELINE);
		if (active.has("apply_patch")) guidelines.push(EDIT_GUIDELINE);
		guidelines.push(CONCURRENCY_GUIDELINE);
	} else if (
		active.has("exec") &&
		active.has("wait") &&
		(mode !== "ts" || active.has("notebook"))
	) {
		const rules =
			mode === "ts"
				? TS_MODE_GUIDELINES
				: mode === "vm"
					? VM_MODE_GUIDELINES
					: CODE_MODE_GUIDELINES;
		guidelines.push(
			...rules.filter(
				(rule) =>
					rule !== NOTEBOOK_SHELL_GUIDELINE ||
					nestedTools.includes("exec_command"),
			),
		);
	}
	if (piPackageRoot)
		guidelines.push(
			`Pi customization or integration: list ${piPackageRoot} before implementing`,
		);
	return guidelines;
}

export function mergeCodexGuidelines(
	base: readonly string[],
	mode: CodexPromptMode,
	options: {
		removePiDefaults?: boolean;
		piPackageRoot?: string;
		selectedTools?: readonly string[];
		nestedTools?: readonly string[];
	} = {},
): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	const add = (value: string): void => {
		const trimmed = value.trim();
		const canonical =
			STATIC_CODEX_GUIDELINES_BY_KEY.get(
				withoutCosmeticTerminalPeriod(trimmed),
			) ?? trimmed;
		const key = withoutCosmeticTerminalPeriod(canonical);
		if (!canonical || seen.has(key) || key === OBSOLETE_GUIDELINE) return;
		if (options.removePiDefaults && PI_DEFAULT_GUIDELINES.has(key)) return;
		if (mode !== "normal" && CODE_MODE_REPLACED_GUIDELINES.has(key)) return;
		seen.add(key);
		merged.push(canonical);
	};
	for (const guideline of base) add(guideline);
	for (const guideline of buildCodexGuidelines(
		mode,
		options.selectedTools ?? [],
		options.piPackageRoot,
		options.nestedTools,
	))
		add(guideline);
	return merged;
}

export function selectedToolGuidelines(
	options: PiSystemPromptOptions,
): string[] {
	return options.selectedTools
		.filter((name) => !options.hiddenTools.includes(name))
		.flatMap((name) => options.toolGuidelines[name] ?? []);
}

export function formatGuidelines(
	guidelines: readonly string[],
	shell?: string,
	customization?: string,
): string {
	return [
		...guidelines,
		shell ? formatShellContext(shell) : undefined,
		customization,
	]
		.filter(Boolean)
		.join("\n");
}

export function withoutCodexGuidelines(
	guidelines: readonly string[],
): string[] {
	return guidelines.filter((guideline) => {
		const key = withoutCosmeticTerminalPeriod(guideline.trim());
		return (
			!STATIC_CODEX_GUIDELINES_BY_KEY.has(key) && key !== OBSOLETE_GUIDELINE
		);
	});
}

function formatShellContext(shell: string): string {
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	const zshGuidance =
		shellName === "zsh" || shellName === "zsh.exe" ? "; capture $? as rc" : "";
	return `Shell=${shell}; obey syntax/quoting/variablerules${zshGuidance}`;
}
