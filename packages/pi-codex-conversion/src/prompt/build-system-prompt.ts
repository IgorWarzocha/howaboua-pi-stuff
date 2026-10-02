import { getPackageDir, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { codeModeCustomizationGuidance } from "../tools/code-mode/custom-tool-prompt.js";

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

const RUNTIME_IDENTITY_GUIDELINE = "You are running in Pi with Codex-native tools";
const FOLLOW_THROUGH_GUIDELINE = "Finish the requested work; ask only when missing information changes what you should do.";

const NORMAL_CODEX_GUIDELINES = [
	"Use exec_command for shell commands; prefer rg and rg --files; filter large output at the source",
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text edits, creates, deletes, and moves; split oversized patches",
	"Run independent tool calls in parallel when practical",
];

const CODE_MODE_GUIDELINES = [
	"Use tools.exec_command for shell commands; prefer rg and rg --files; filter large output at the source",
	"Use the other JavaScript quote style around quoted text; preserve literal ${...} and backticks in shell, patches, and source",
	"Await long tools.exec_command calls inside exec",
	"Use tty=true for input and persistent processes",
	"Patch each file in one tools.apply_patch call, splitting oversized patches sequentially; batch independent files with Promise.allSettled; reserve shell/Python for formatting and bulk rewrites",
	"Await dependencies; use Promise.all for independent calls",
	"Return concise exec output with text()",
];

const NOTEBOOK_MODE_GUIDELINES = [
	"Reuse matching retained globals",
	"Keep one-offs block-local; retain reusable analysis and helpers as named globals with concise description/usage; pin valuable state before pruning",
	...CODE_MODE_GUIDELINES,
	'Notebook state management: notebook({input:"help"})',
	"Keep canonical project artifacts in files; carry shell state across tools.exec_command calls through files or arguments",
	"Keep retained helpers self-contained; recreate imports, closures, and live handles after restart",
	"exec calls run sequentially",
];

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
			NORMAL_CODEX_GUIDELINES[3],
		].filter((guideline): guideline is string => guideline !== undefined);
	} else {
		const adapterSurfaceActive = active.has("exec") && active.has("wait") && (mode === "code" || active.has("notebook"));
		guidelines = adapterSurfaceActive
			? [...(mode === "notebook" ? NOTEBOOK_MODE_GUIDELINES : CODE_MODE_GUIDELINES)]
			: [];
	}
	guidelines.unshift(RUNTIME_IDENTITY_GUIDELINE, FOLLOW_THROUGH_GUIDELINE);
	if (piPackageRoot) {
		guidelines.push(`Pi customization or integration: list ${piPackageRoot} before implementing`);
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
		"Read skills named by the user or matching the task; resolve relative paths from the skill directory and load needed references",
	];

	for (const skill of skills) {
		lines.push(`- ${skill.name}: ${skill.description} (file: ${skill.filePath})`);
	}

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

function formatGuidelines(guidelines: readonly string[], shell?: string, customization?: string): string {
	const editing = new Set([NORMAL_CODEX_GUIDELINES[2], CODE_MODE_GUIDELINES[4]]);
	const execution = new Set<string>([...NORMAL_CODEX_GUIDELINES, ...CODE_MODE_GUIDELINES, "exec calls run sequentially"]);
	const notebook = new Set<string>(NOTEBOOK_MODE_GUIDELINES);
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
	delete sections["codex_skills"];
	if (!content) {
		delete sections["skill_catalog"];
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
	defineOwnedSection(sections, "skill_catalog", () => !piWillRenderSkills() && codexCanReadSkills() ? content : "");
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
	delete sections["codex_runtime"];

	if (options.forceSystemPrompt !== undefined) {
		const guidelines = formatGuidelines(mergeCodexGuidelines([], mode, { selectedTools: options.selectedTools }), shell, codeModeCustomizationGuidance(options));
		let forced = upsertOpaqueSection(options.forceSystemPrompt, "runtime_guidelines", guidelines);
		forced = upsertOpaqueSection(forced, "codex_skills", "");
		forced = upsertOpaqueSection(forced, "skill_catalog", buildSkillsContent(skills));
		forced = upsertOpaqueSection(forced, "codex_runtime", "");
		options.forceSystemPrompt = forced;
		return;
	}

	const heavyPreamble = `Guidelines:\n${formatGuidelines([FOLLOW_THROUGH_GUIDELINE])}`;
	const customPrompt = options.customPrompt === heavyPreamble ? undefined : options.customPrompt;
	if (config.heavySystemPromptOverwrite) {
		if (!customPrompt) options.customPrompt = heavyPreamble;
		defineOwnedSection(sections, "runtime_guidelines", () => {
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
			return formatGuidelines(sectionGuidelines, shell, codeModeCustomizationGuidance(options));
		});
	} else {
		options.promptGuidelines = withoutCodexGuidelines(options.promptGuidelines);
		defineOwnedSection(sections, "runtime_guidelines", () =>
			formatGuidelines(mergeCodexGuidelines([], mode, { selectedTools: options.selectedTools }), shell, codeModeCustomizationGuidance(options)));
	}

	prepareStructuredSkills(options, skills, mode, Boolean(config.heavySystemPromptOverwrite));
}

function formatShellContext(shell: string): string {
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	const zshGuidance = shellName === "zsh" || shellName === "zsh.exe"
		? "; capture $? as rc"
		: "";
	return `Current shell: ${shell}; follow its syntax, quoting, and variable rules${zshGuidance}`;
}
