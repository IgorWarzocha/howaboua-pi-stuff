import { getPackageDir, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { HeavySystemPromptOverwrite } from "../adapter/activation/config-contract.js";
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

const RUNTIME_IDENTITY_GUIDELINE = ["You are running in Pi with Codex-native tools", "Pi; Codex-native tools"] as const;
const FOLLOW_THROUGH_GUIDELINE = ["Finish the requested work; ask only when missing information changes what you should do.", "Finish requestedwork; ask only if missinginfo changes action"] as const;

const NORMAL_CODEX_GUIDELINES = [
	["Use exec_command for shell commands; prefer rg and rg --files; filter large output at the source", "Shell→exec_command; prefer rg/rg --files; largeoutput→sourcefilter"],
	["Reserve tty=true for input or persistent processes", "tty=true only for input/persistent processes"],
	["Use apply_patch for text edits, creates, deletes, and moves; split oversized patches", "Text edits/creates/deletes/moves→apply_patch; split oversized patches"],
	["Run independent tool calls in parallel when practical", "Independentcalls→parallel when practical"],
] as const;

const CODE_MODE_GUIDELINES = [
	["Use tools.exec_command for shell commands; prefer rg and rg --files; filter large output at the source", "Shell→tools.exec_command; prefer rg/rg --files; largeoutput→sourcefilter"],
	["Use the other JavaScript quote style around quoted text; preserve literal ${...} and backticks in shell, patches, and source", "JS: quotedtext→alternate outerquotes; shell/patches/source→preserve literal ${...}/backticks"],
	["Await long tools.exec_command calls inside exec", "Long tools.exec_command→await inside exec"],
	["Use tty=true for input and persistent processes", "Input/persistent processes→tty=true"],
	["Patch each file in one tools.apply_patch call, splitting oversized patches sequentially; batch independent files with Promise.allSettled; reserve shell/Python for formatting and bulk rewrites", "tools.apply_patch: onecall/file; oversized→sequential splits; independentfiles→Promise.allSettled; shell/Python only formatting/bulkrewrite"],
	["Await dependencies; use Promise.all for independent calls", "Dependencies→await; independent calls→Promise.all"],
	["Return concise exec output with text()", "Output→concise text()"],
] as const;

const STATEFUL_MODE_GUIDELINES = [
	["Reuse matching retained globals", "Reuse matching retained globals"],
	["Keep one-offs block-local. Retain only what you plan to reuse, and clean up when the task ends.", "One-offs→blocklocal; retain only plannedreuse; taskdone→cleanup"],
	...CODE_MODE_GUIDELINES,
	["Notebook state management: notebook({})", "Manage state: notebook({})"],
	["Keep canonical project artifacts in files; carry shell state across tools.exec_command calls through files or arguments", "Canonicalartifacts→files; tools.exec_command crosscall shellstate→files/args"],
] as const;

const NOTEBOOK_MODE_GUIDELINES = [
	...STATEFUL_MODE_GUIDELINES,
	["Keep retained helpers self-contained; recreate imports, closures, and live handles after restart", "Retainedhelpers=selfcontained; restart→recreate imports/closures/livehandles"],
	["exec calls run sequentially", "exec calls sequential"],
] as const;

const TS_MODE_GUIDELINES = [
	...STATEFUL_MODE_GUIDELINES,
	["Normal exec cells run one at a time. Inspect variables after errors before retrying", "Normal exec cells run one at a time; inspect variables after errors before retrying"],
	["After restart, recreate any values reported as unsaved", "After restart, recreate values reported as unsaved"],
] as const;

const JS_MODE_GUIDELINES = [
	...STATEFUL_MODE_GUIDELINES,
	["Normal exec cells share serial live state; inspect mutations after errors before retrying", "Normal cells share serial live state; inspect mutations after errors"],
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

export type CodexPromptMode = "normal" | "code" | "notebook" | "ts" | "js";

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

function buildSkillsContent(skills: PromptSkill[], gpt = false): string {
	if (skills.length === 0) return "";
	const lines = [
		gpt ? "Read usernamed/taskmatching skills; relativepaths→skilldir; load neededrefs"
			: "Read skills named by the user or matching the task; resolve relative paths from the skill directory and load needed references",
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
	heavySystemPromptOverwrite?: HeavySystemPromptOverwrite | undefined;
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
	return (options.selectedTools ?? [])
		.filter((name) => !options.hiddenTools?.includes(name))
		.flatMap((name) => options.toolGuidelines?.[name] ?? []);
}

function formatGuidelines(guidelines: readonly string[], shell?: string, customization?: string, gpt = false): string {
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
	gpt: boolean,
): void {
	const sections = options.sections ??= {};
	const content = buildSkillsContent(skills, gpt);
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
	const gpt = config.heavySystemPromptOverwrite === "gpt";
	const skills = config.skills ?? [];
	const shell = config.shell;
	const sections = options.sections ??= {};
	delete sections["codex_runtime"];

	if (options.forceSystemPrompt !== undefined) {
		const guidelines = formatGuidelines(mergeCodexGuidelines([], mode, { selectedTools: options.selectedTools }), shell, codeModeCustomizationGuidance(options), gpt);
		let forced = upsertOpaqueSection(options.forceSystemPrompt, "runtime_guidelines", guidelines);
		forced = upsertOpaqueSection(forced, "codex_skills", "");
		forced = upsertOpaqueSection(forced, "skill_catalog", buildSkillsContent(skills, gpt));
		forced = upsertOpaqueSection(forced, "codex_runtime", "");
		options.forceSystemPrompt = forced;
		return;
	}

	const heavyPreamble = `Guidelines:\n${formatGuidelines([FOLLOW_THROUGH_GUIDELINE[0]])}`;
	const gptPreamble = FOLLOW_THROUGH_GUIDELINE[1];
	const customPrompt = options.customPrompt === heavyPreamble || options.customPrompt === gptPreamble ? undefined : options.customPrompt;
	if (config.heavySystemPromptOverwrite) {
		if (!customPrompt) options.customPrompt = gpt ? gptPreamble : heavyPreamble;
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
				: guidelines.filter((guideline) => guideline !== FOLLOW_THROUGH_GUIDELINE[0]);
			return formatGuidelines(sectionGuidelines, shell, codeModeCustomizationGuidance(options), gpt);
		});
	} else {
		options.promptGuidelines = withoutCodexGuidelines(options.promptGuidelines);
		defineOwnedSection(sections, "runtime_guidelines", () =>
			formatGuidelines(mergeCodexGuidelines([], mode, { selectedTools: options.selectedTools }), shell, codeModeCustomizationGuidance(options)));
	}

	prepareStructuredSkills(options, skills, mode, Boolean(config.heavySystemPromptOverwrite), gpt);
}

function formatShellContext(shell: string, gpt = false): string {
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	const zshGuidance = shellName === "zsh" || shellName === "zsh.exe"
		? "; capture $? as rc"
		: "";
	return gpt ? `Shell=${shell}; obey syntax/quoting/variablerules${zshGuidance}`
		: `Current shell: ${shell}; follow its syntax, quoting, and variable rules${zshGuidance}`;
}
