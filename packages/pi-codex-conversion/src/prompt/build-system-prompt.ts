import { getPackageDir, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

export interface PromptSkill {
	name: string;
	description: string;
	filePath: string;
}

export interface StructuredPromptSkill {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation?: boolean | undefined;
}

export type PiSystemPromptOptions = NormalizedBuildSystemPromptOptions;

const PI_DEFAULT_GUIDELINES = new Set([
	"Use bash for file operations like ls, rg, find",
	"Be concise in your responses",
	"Show file paths clearly when working with files",
]);

const EXEC_SESSION_GUIDELINE = "For unfinished exec_command sessions, use write_stdin with yield_time_ms near the command's expected remaining time and lengthen later waits";
const FOLLOW_THROUGH_GUIDELINE = "Finish the requested work; ask only when missing information changes what you should do.";

const NORMAL_CODEX_GUIDELINES = [
	"Use exec_command for shell commands, file inspection, builds, and tests; use rg and rg --files for discovery; filter large output at the source",
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	EXEC_SESSION_GUIDELINE,
	"Run independent tool calls in parallel when practical",
];

const CODE_MODE_GUIDELINES = [
	"Use tools.exec_command for shell commands; prefer rg and rg --files; filter large output at the source",
	"Use the other JavaScript quote style around quoted text; preserve literal ${...} and backticks in shell, patches, and source",
	"Await long tools.exec_command calls inside exec; resume their yielded cell_id with wait near completion",
	"Use tty=true for input and persistent processes",
	"Patch each file in one tools.apply_patch call, splitting oversized patches sequentially; batch independent files with Promise.allSettled, inspect every result, and resolve failures; reserve shell/Python for formatting and bulk rewrites",
	"Await dependencies; use Promise.all for independent calls",
	"Return concise exec output with text()",
];

const NOTEBOOK_MODE_GUIDELINES = [
	"exec is a persistent Deno/TypeScript Jupyter notebook; project globals may come from earlier agents and sessions",
	"Reuse matching retained globals; inspect description/usage before creating reusable ones",
	"Keep one-offs block-local; retain reusable analysis and helpers as named globals with concise description/usage; pin valuable state before pruning",
	...CODE_MODE_GUIDELINES,
	"Diagnose state or helper failures; repair or prune failed state and verify recovery",
	"Filter retained data inside exec and return the needed findings",
	"Keep canonical project artifacts in files; carry shell state across tools.exec_command calls through files or arguments",
	"Keep retained helpers self-contained; recreate imports, closures, and live handles after restart",
	"Notebook reports memory warnings; release/prune before pressure becomes critical",
	"exec calls run sequentially; use wait to observe or terminate the currently yielded call",
	"Treat Notebook as a persistent Deno REPL: build small programs on retained state across cells",
];

const CODE_MODE_REPLACED_GUIDELINES = new Set([
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	"Run independent tool calls in parallel when practical",
]);

const REMOVED_GUIDELINES = new Set([
	"Prefer the apply_patch tool; use shell apply_patch only when chaining edits with other shell steps",
]);

const ALL_STATIC_CODEX_GUIDELINES = [
	FOLLOW_THROUGH_GUIDELINE,
	...NORMAL_CODEX_GUIDELINES,
	...CODE_MODE_GUIDELINES,
	...NOTEBOOK_MODE_GUIDELINES,
];

function withoutCosmeticTerminalPeriod(value: string): string {
	return value.endsWith(".") && !value.endsWith("..") ? value.slice(0, -1) : value;
}

const STATIC_CODEX_GUIDELINES_BY_KEY = new Map(
	[
		...ALL_STATIC_CODEX_GUIDELINES.map((guideline) => [withoutCosmeticTerminalPeriod(guideline), guideline] as const),
		["Use tty=true for dev servers, watchers, REPLs, and prompts", NORMAL_CODEX_GUIDELINES[1]!],
		["Use tty=true for interactive commands", NORMAL_CODEX_GUIDELINES[1]!],
	],
);

export type CodexPromptMode = "normal" | "code" | "notebook";

function buildCodexGuidelines(
	mode: CodexPromptMode,
	selectedTools: readonly string[],
	piPackageRoot?: string,
): string[] {
	const active = new Set(selectedTools);
	let guidelines: string[];
	if (mode === "normal") {
		guidelines = [
			active.has("exec_command") ? NORMAL_CODEX_GUIDELINES[0] : undefined,
			active.has("exec_command") ? NORMAL_CODEX_GUIDELINES[1] : undefined,
			active.has("apply_patch") ? NORMAL_CODEX_GUIDELINES[2] : undefined,
			active.has("exec_command") && active.has("write_stdin") ? NORMAL_CODEX_GUIDELINES[3] : undefined,
			NORMAL_CODEX_GUIDELINES[4],
		].filter((guideline): guideline is string => guideline !== undefined);
	} else {
		const adapterSurfaceActive = active.has("exec") && active.has("wait") && (mode === "code" || active.has("notebook"));
		guidelines = adapterSurfaceActive
			? [...(mode === "notebook" ? NOTEBOOK_MODE_GUIDELINES : CODE_MODE_GUIDELINES)]
			: [];
	}
	guidelines.unshift(FOLLOW_THROUGH_GUIDELINE);
	if (piPackageRoot) {
		guidelines.push(`When work depends on Pi APIs or runtime behavior not established in the current repository, consult the relevant README.md, docs/, or examples/ files under ${piPackageRoot} and follow their references before implementing`);
	}
	return guidelines;
}

function decodeXml(text: string): string {
	return text
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&");
}

export function extractPiPromptSkills(prompt: string): PromptSkill[] {
	const skillsBlockMatch = prompt.match(/<available_skills>\n([\s\S]*?)\n<\/available_skills>/);
	if (!skillsBlockMatch) {
		return [];
	}

	const skillMatches = skillsBlockMatch[1]!.matchAll(
		/<skill>\n\s*<name>([\s\S]*?)<\/name>\n\s*<description>([\s\S]*?)<\/description>\n\s*<location>([\s\S]*?)<\/location>\n\s*<\/skill>/g,
	);

	return Array.from(skillMatches, (match) => ({
		name: decodeXml(match[1]!.trim()),
		description: decodeXml(match[2]!.trim()),
		filePath: decodeXml(match[3]!.trim()),
	}));
}

export function promptSkillsFromStructuredSkills(skills: readonly StructuredPromptSkill[] | undefined): PromptSkill[] {
	if (!Array.isArray(skills)) {
		return [];
	}

	return skills
		.filter((skill) => !skill.disableModelInvocation)
		.map((skill) => ({
			name: skill.name,
			description: skill.description,
			filePath: skill.filePath,
		}));
}

export function resolvePromptSkills(
	structuredSkills: readonly StructuredPromptSkill[] | undefined,
	fallbackSkills: readonly PromptSkill[],
): PromptSkill[] {
	return structuredSkills === undefined ? [...fallbackSkills] : promptSkillsFromStructuredSkills(structuredSkills);
}

function buildSkillsContent(skills: PromptSkill[]): string {
	if (skills.length === 0) return "";
	const lines = [
		"## Skills",
		"### Available skills",
	];

	for (const skill of skills) {
		lines.push(`- ${skill.name}: ${skill.description} (file: ${skill.filePath})`);
	}

	lines.push("### How to use skills");
	lines.push("- Use skill when user names it (`$SkillName` or plain text) or request clearly matches its description");
	lines.push("- Use the minimal required set of skills. If multiple apply, use them together and state the order briefly");
	lines.push("- Open each selected `SKILL.md`; resolve relative paths from its directory, load needed references, and reuse available scripts/assets/templates");
	lines.push("- If a skill or path is unavailable, state it briefly and continue with the best fallback");
	return lines.join("\n");
}

export interface PrepareCodexSystemPromptOptions {
	skills?: PromptSkill[] | undefined;
	shell?: string | undefined;
	mode?: CodexPromptMode | undefined;
	heavySystemPromptOverwrite?: boolean | undefined;
}

function canonicalGuideline(value: string): string {
	const trimmed = value.trim();
	return STATIC_CODEX_GUIDELINES_BY_KEY.get(withoutCosmeticTerminalPeriod(trimmed)) ?? trimmed;
}

function mergeCodexGuidelines(
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

function selectedToolGuidelines(options: PiSystemPromptOptions): string[] {
	return (options.selectedTools ?? []).flatMap((name) => options.toolGuidelines?.[name] ?? []);
}

function formatGuidelines(guidelines: readonly string[]): string {
	return `Guidelines:\n${guidelines.map((line) => `- ${line}`).join("\n")}`;
}

function withoutCodexGuidelines(guidelines: readonly string[]): string[] {
	return guidelines.filter((guideline) => {
		const key = withoutCosmeticTerminalPeriod(guideline.trim());
		return !STATIC_CODEX_GUIDELINES_BY_KEY.has(key) && !REMOVED_GUIDELINES.has(key);
	});
}

function defineOwnedSection(
	sections: Record<string, string>,
	name: string,
	render: () => string,
): void {
	let override: string | undefined;
	Object.defineProperty(sections, name, {
		configurable: true,
		enumerable: true,
		get: () => override ?? render(),
		set: (value: string) => {
			override = value;
		},
	});
}

function upsertOpaqueSection(prompt: string, name: string, content: string): string {
	const open = `<${name}>`;
	const close = `</${name}>`;
	const start = prompt.indexOf(open);
	const end = start === -1 ? -1 : prompt.indexOf(close, start + open.length);
	if (start !== -1 && end !== -1) {
		const after = end + close.length;
		if (!content) return `${prompt.slice(0, start)}${prompt.slice(after)}`.replace(/\n{3,}/g, "\n\n").trim();
		return `${prompt.slice(0, start)}${open}\n${content}\n${close}${prompt.slice(after)}`;
	}
	if (!content) return prompt;
	return `${prompt.trimEnd()}\n\n${open}\n${content}\n${close}`;
}

function prepareStructuredSkills(
	options: PiSystemPromptOptions,
	skills: PromptSkill[],
	mode: CodexPromptMode,
	heavy: boolean,
): void {
	const sections = options.sections ??= {};
	const content = buildSkillsContent(skills);
	if (!content) {
		delete sections["codex_skills"];
		return;
	}
	const piWillRenderSkills = () => options.selectedTools.includes("read") || options.selectedTools.includes("bash");
	const codexCanReadSkills = () => mode === "normal"
		? options.selectedTools.includes("exec_command")
		: options.selectedTools.includes("exec")
			&& options.selectedTools.includes("wait")
			&& (mode === "code" || options.selectedTools.includes("notebook"));
	if (heavy && sections["skills"] === undefined) {
		defineOwnedSection(sections, "skills", () => piWillRenderSkills() ? content : "");
	}
	defineOwnedSection(sections, "codex_skills", () => !piWillRenderSkills() && codexCanReadSkills() ? content : "");
}

/** Mutate Pi's current structured prompt options without forcing a full prompt replacement. */
export function prepareCodexSystemPrompt(
	options: PiSystemPromptOptions,
	config: PrepareCodexSystemPromptOptions = {},
): void {
	const mode = config.mode ?? "normal";
	const skills = config.skills ?? [];
	const shell = config.shell;
	const sections = options.sections ??= {};

	if (options.forceSystemPrompt !== undefined) {
		const guidelines = formatGuidelines(mergeCodexGuidelines([], mode, { selectedTools: options.selectedTools }));
		let forced = upsertOpaqueSection(options.forceSystemPrompt, "codex_guidelines", guidelines);
		forced = upsertOpaqueSection(forced, "codex_skills", buildSkillsContent(skills));
		forced = upsertOpaqueSection(forced, "codex_runtime", shell ? formatShellContext(shell) : "");
		options.forceSystemPrompt = forced;
		return;
	}

	const heavyPreamble = formatGuidelines([FOLLOW_THROUGH_GUIDELINE]);
	const customPrompt = options.customPrompt === heavyPreamble ? undefined : options.customPrompt;
	if (config.heavySystemPromptOverwrite) {
		if (!customPrompt) options.customPrompt = heavyPreamble;
		defineOwnedSection(sections, "codex_guidelines", () => {
			const contributed = customPrompt
				? []
				: [
					...selectedToolGuidelines(options),
					...options.promptGuidelines,
				];
			const guidelines = mergeCodexGuidelines(contributed, mode, {
				removePiDefaults: true,
				selectedTools: options.selectedTools,
				...(!customPrompt ? { piPackageRoot: getPackageDir() } : {}),
			});
			const sectionGuidelines = customPrompt
				? guidelines
				: guidelines.filter((guideline) => guideline !== FOLLOW_THROUGH_GUIDELINE);
			return sectionGuidelines.length > 0 ? formatGuidelines(sectionGuidelines) : "";
		});
	} else {
		options.promptGuidelines = withoutCodexGuidelines(options.promptGuidelines);
		defineOwnedSection(sections, "codex_guidelines", () =>
			formatGuidelines(mergeCodexGuidelines([], mode, { selectedTools: options.selectedTools })));
	}

	prepareStructuredSkills(options, skills, mode, Boolean(config.heavySystemPromptOverwrite));
	if (shell) sections["codex_runtime"] = formatShellContext(shell);
	else delete sections["codex_runtime"];
}

function formatShellContext(shell: string): string {
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	const zshGuidance = shellName === "zsh" || shellName === "zsh.exe"
		? "; capture $? as rc"
		: "";
	return `Current shell: ${shell}; follow its syntax, quoting, and variable rules${zshGuidance}`;
}
