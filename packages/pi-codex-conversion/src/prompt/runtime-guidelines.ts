import type { CodexPromptMode, PiSystemPromptOptions } from "./build-system-prompt.ts";

const PI_DEFAULT_GUIDELINES = new Set([
	"Use bash for file operations like ls, rg, find",
	"Be concise in your responses",
	"Show file paths clearly when working with files",
]);

const RUNTIME_IDENTITY_GUIDELINE = ["You are running in Pi with Codex-native tools", "Pi; Codex-native tools"] as const;
export const FOLLOW_THROUGH_GUIDELINE = ["Finish the requested work; ask only when missing information changes what you should do.", "Finish work; ask ONLY if missing info changes action"] as const;

const NORMAL_CODEX_GUIDELINES = [
	["Use exec_command for shell commands; prefer rg and rg --files; filter large output at the source", "Shell→exec_command; prefer rg/rg --files; largeoutput→sourcefilter"],
	["Reserve tty=true for input or persistent processes", "tty=true ONLY for input/persistent processes"],
	["Use apply_patch for text edits, creates, deletes, and moves; split oversized patches", "Text edits/creates/deletes/moves→apply_patch; oversized→split"],
	["Run independent tool calls in parallel when practical", "Independent calls→parallel when practical"],
] as const;

const CODE_MODE_GUIDELINES = [
	["Use tools.exec_command for shell commands; prefer rg and rg --files; filter large output at the source", "Shell→tools.exec_command; prefer rg/rg --files; largeoutput→sourcefilter"],
	["Use the other JavaScript quote style around quoted text; preserve literal ${...} and backticks in shell, patches, and source", "Quoted text→alternate JS quotes; shell/patch/source→literal ${...}/backticks"],
	["Await long tools.exec_command calls inside exec", "Long tools.exec_command→await inside exec"],
	["Use tty=true for input and persistent processes", "Input/persistent processes→tty=true"],
	["Patch each file in one tools.apply_patch call, splitting oversized patches sequentially; batch independent files with Promise.allSettled; reserve shell/Python for formatting and bulk rewrites", "tools.apply_patch: 1/file; oversized→serial splits; independent files→Promise.allSettled; shell/Python ONLY formatting/bulk rewrites"],
	["Compose known tool calls in one exec; await dependencies in order and run independent calls concurrently. Bound output at the source", "Known calls→one exec; dependencies→ordered awaits; independent calls→concurrent; bound output at source"],
	["Return concise exec output with text()", "Output→concise text()"],
] as const;

const STATEFUL_MODE_GUIDELINES = [
	["Reuse matching retained globals", "Reuse matching globals"],
	["Keep one-offs block-local. Retain only what you plan to reuse, and clean up when the task ends.", "One-offs→block-local; retain ONLY planned reuse; task done→cleanup"],
	...CODE_MODE_GUIDELINES,
	["Notebook state management: notebook({})", "Manage state: notebook({})"],
	["Keep canonical project artifacts in files; carry shell state across tools.exec_command calls through files or arguments", "Canonical artifacts→files; shell state across tools.exec_command→files/args"],
] as const;

const NOTEBOOK_MODE_GUIDELINES = [
	...STATEFUL_MODE_GUIDELINES,
	["Keep retained helpers self-contained; recreate imports, closures, and live handles after restart", "Helpers=self-contained; restart→recreate imports/closures/live handles"],
	["Normal exec cells run one at a time", "Normal cells→serial"],
] as const;

const TS_MODE_GUIDELINES = [
	...STATEFUL_MODE_GUIDELINES,
	["Normal exec cells run one at a time. Inspect variables after errors before retrying", "Normal cells→serial; error→inspect state BEFORE retry"],
	["After restart, recreate any values reported as unsaved", "Restart→recreate reported unsaved values"],
] as const;

const JS_MODE_GUIDELINES = [
	...STATEFUL_MODE_GUIDELINES,
	["Normal exec cells share serial live state; inspect mutations after errors before retrying", "Normal cells→shared serial state; error→inspect mutations BEFORE retry"],
] as const;

const CODE_MODE_REPLACED_GUIDELINES = new Set([
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text edits, creates, deletes, and moves; split oversized patches",
	"Run independent tool calls in parallel when practical",
]);

const REMOVED_GUIDELINES = new Set([
	"Prefer the apply_patch tool; use shell apply_patch only when chaining edits with other shell steps",
]);

const ALL_STATIC_CODEX_GUIDELINES = [
	RUNTIME_IDENTITY_GUIDELINE,
	FOLLOW_THROUGH_GUIDELINE,
	...NORMAL_CODEX_GUIDELINES,
	...CODE_MODE_GUIDELINES,
	...NOTEBOOK_MODE_GUIDELINES,
	...TS_MODE_GUIDELINES,
	...JS_MODE_GUIDELINES,
];
const GPT_GUIDELINES = new Map<string, string>(ALL_STATIC_CODEX_GUIDELINES);

function withoutCosmeticTerminalPeriod(value: string): string {
	return value.endsWith(".") && !value.endsWith("..") ? value.slice(0, -1) : value;
}

const STATIC_CODEX_GUIDELINES_BY_KEY = new Map(
	[
		...ALL_STATIC_CODEX_GUIDELINES.map(([guideline]) => [withoutCosmeticTerminalPeriod(guideline), guideline] as const),
		["Use tty=true for dev servers, watchers, REPLs, and prompts", NORMAL_CODEX_GUIDELINES[1][0]],
		["Use tty=true for interactive commands", NORMAL_CODEX_GUIDELINES[1][0]],
	],
);

function buildCodexGuidelines(
	mode: CodexPromptMode,
	selectedTools: readonly string[],
	piPackageRoot?: string,
): string[] {
	const active = new Set(selectedTools);
	let guidelines: string[];
	if (mode === "normal") {
		guidelines = [
			active.has("exec_command") ? NORMAL_CODEX_GUIDELINES[0][0] : undefined,
			active.has("exec_command") ? NORMAL_CODEX_GUIDELINES[1][0] : undefined,
			active.has("apply_patch") ? NORMAL_CODEX_GUIDELINES[2][0] : undefined,
			NORMAL_CODEX_GUIDELINES[3][0],
		].filter((guideline) => guideline !== undefined);
	} else {
		const adapterSurfaceActive = active.has("exec") && active.has("wait") && (mode === "code" || active.has("notebook"));
		guidelines = adapterSurfaceActive
			? (mode === "notebook" ? NOTEBOOK_MODE_GUIDELINES : mode === "ts" ? TS_MODE_GUIDELINES : mode === "js" ? JS_MODE_GUIDELINES : CODE_MODE_GUIDELINES).map(([guideline]) => guideline)
			: [];
	}
	guidelines.unshift(RUNTIME_IDENTITY_GUIDELINE[0], FOLLOW_THROUGH_GUIDELINE[0]);
	if (piPackageRoot) {
		guidelines.push(`Pi customization or integration: list ${piPackageRoot} before implementing`);
	}
	return guidelines;
}

function canonicalGuideline(value: string): string {
	const trimmed = value.trim();
	return STATIC_CODEX_GUIDELINES_BY_KEY.get(withoutCosmeticTerminalPeriod(trimmed)) ?? trimmed;
}

export function mergeCodexGuidelines(
	base: readonly string[],
	mode: CodexPromptMode,
	options: { removePiDefaults?: boolean; piPackageRoot?: string; selectedTools?: readonly string[] } = {},
): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	const add = (value: string): void => {
		const canonical = canonicalGuideline(value);
		const key = withoutCosmeticTerminalPeriod(canonical);
		if (!canonical || seen.has(key)) return;
		if (REMOVED_GUIDELINES.has(key)) return;
		if (options.removePiDefaults && PI_DEFAULT_GUIDELINES.has(key)) return;
		if (mode !== "normal" && CODE_MODE_REPLACED_GUIDELINES.has(key)) return;
		seen.add(key);
		merged.push(canonical);
	};
	for (const guideline of base) add(guideline);
	for (const guideline of buildCodexGuidelines(mode, options.selectedTools ?? [], options.piPackageRoot)) add(guideline);
	return merged;
}

export function selectedToolGuidelines(options: PiSystemPromptOptions): string[] {
	return (options.selectedTools ?? [])
		.filter((name) => !options.hiddenTools?.includes(name))
		.flatMap((name) => options.toolGuidelines?.[name] ?? []);
}

export function formatGuidelines(guidelines: readonly string[], shell?: string, customization?: string, gpt = false): string {
	if (gpt) return [
		...guidelines.map((line) => GPT_GUIDELINES.get(line) ?? line),
		shell ? formatShellContext(shell, true) : undefined,
		customization,
	].filter(Boolean).join("\n");
	const editing = new Set<string>([NORMAL_CODEX_GUIDELINES[2][0], CODE_MODE_GUIDELINES[4][0]]);
	const execution = new Set<string>([...NORMAL_CODEX_GUIDELINES, ...CODE_MODE_GUIDELINES].map(([guideline]) => guideline));
	execution.add("exec calls run sequentially");
	const notebook = new Set<string>([...NOTEBOOK_MODE_GUIDELINES, ...TS_MODE_GUIDELINES, ...JS_MODE_GUIDELINES].map(([guideline]) => guideline));
	const general: string[] = [];
	const groups: Record<string, string[]> = {
		Execution: [],
		Editing: [],
		"Notebook state": [],
		"Harness customization": [],
	};
	for (const line of guidelines) {
		const group = editing.has(line) ? "Editing"
			: execution.has(line) ? "Execution"
			: notebook.has(line) ? "Notebook state"
			: line.startsWith("Pi customization or integration:") ? "Harness customization"
			: undefined;
		(group ? groups[group]! : general).push(line);
	}
	if (shell) groups["Execution"]!.push(formatShellContext(shell));
	if (customization) groups["Harness customization"]!.push(customization);
	const bullets = (lines: readonly string[]) => lines.map((line) => `- ${line}`).join("\n");
	return [
		bullets(general),
		...Object.entries(groups).filter(([, lines]) => lines.length > 0)
			.map(([heading, lines]) => `### ${heading}\n${bullets(lines)}`),
	].filter(Boolean).join("\n\n");
}

export function withoutCodexGuidelines(guidelines: readonly string[]): string[] {
	return guidelines.filter((guideline) => {
		const key = withoutCosmeticTerminalPeriod(guideline.trim());
		return !STATIC_CODEX_GUIDELINES_BY_KEY.has(key) && !REMOVED_GUIDELINES.has(key);
	});
}

function formatShellContext(shell: string, gpt = false): string {
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	const zshGuidance = shellName === "zsh" || shellName === "zsh.exe"
		? "; capture $? as rc"
		: "";
	return gpt ? `Shell=${shell}; obey syntax/quoting/variablerules${zshGuidance}`
		: `Current shell: ${shell}; follow its syntax, quoting, and variable rules${zshGuidance}`;
}
