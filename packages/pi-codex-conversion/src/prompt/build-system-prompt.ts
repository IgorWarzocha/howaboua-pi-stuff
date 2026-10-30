import { FOLLOW_THROUGH_GUIDELINE, formatGuidelines, mergeCodexGuidelines, selectedToolGuidelines, withoutCodexGuidelines } from "./runtime-guidelines.ts";
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

export type CodexPromptMode = "normal" | "code" | "notebook" | "ts" | "js";

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
		gpt ? "Read named/task-matching skills; relative paths→skill dir; load needed refs"
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
