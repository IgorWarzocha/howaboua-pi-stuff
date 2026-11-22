import {
	GENERAL_GUIDELINES,
	formatGuidelines,
	mergeCodexGuidelines,
	selectedToolGuidelines,
	withoutCodexGuidelines,
} from "./runtime-guidelines.ts";
import {
	getPackageDir,
	type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import {
	codeModeCustomizationGuidance,
	codeModePromptToolNames,
} from "../tools/code-mode/custom-tool-prompt.js";

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

export type CodexPromptMode = "normal" | "code" | "ts" | "vm";

function decodeXml(text: string): string {
	return text
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&");
}

export function extractPiPromptSkills(prompt: string): PromptSkill[] {
	const skillsBlockMatch = prompt.match(
		/<available_skills>\n([\s\S]*?)\n<\/available_skills>/,
	);
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

export function promptSkillsFromStructuredSkills(
	skills: readonly StructuredPromptSkill[] | undefined,
): PromptSkill[] {
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
	return structuredSkills === undefined
		? [...fallbackSkills]
		: promptSkillsFromStructuredSkills(structuredSkills);
}

function buildSkillsContent(skills: PromptSkill[]): string {
	if (skills.length === 0) return "";
	const lines = [
		"Read named/task-matching skills; relative paths→skill dir; load needed refs",
	];

	for (const skill of skills) {
		lines.push(
			`- ${skill.name}: ${skill.description} (file: ${skill.filePath})`,
		);
	}

	return lines.join("\n");
}

export interface PrepareCodexSystemPromptOptions {
	skills?: PromptSkill[] | undefined;
	shell?: string | undefined;
	mode?: CodexPromptMode | undefined;
	heavySystemPromptOverwrite?: boolean | undefined;
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

function upsertOpaqueSection(
	prompt: string,
	name: string,
	content: string,
): string {
	const open = `<${name}>`;
	const close = `</${name}>`;
	const start = prompt.indexOf(open);
	const end = start === -1 ? -1 : prompt.indexOf(close, start + open.length);
	if (start !== -1 && end !== -1) {
		const after = end + close.length;
		if (!content)
			return `${prompt.slice(0, start)}${prompt.slice(after)}`
				.replace(/\n{3,}/g, "\n\n")
				.trim();
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
	const sections = (options.sections ??= {});
	const content = buildSkillsContent(skills);
	delete sections["codex_skills"];
	if (!content) {
		delete sections["skill_catalog"];
		return;
	}
	const piWillRenderSkills = () =>
		options.selectedTools.includes("read") ||
		options.selectedTools.includes("bash");
	const codexCanReadSkills = () =>
		mode === "normal"
			? options.selectedTools.includes("exec_command")
			: options.selectedTools.includes("exec") &&
				options.selectedTools.includes("wait") &&
				(mode === "code" ||
					mode === "vm" ||
					options.selectedTools.includes("notebook"));
	if (heavy && sections["skills"] === undefined) {
		defineOwnedSection(sections, "skills", () =>
			piWillRenderSkills() ? content : "",
		);
	}
	defineOwnedSection(sections, "skill_catalog", () =>
		!piWillRenderSkills() && codexCanReadSkills() ? content : "",
	);
}

/** Mutate Pi's current structured prompt options without forcing a full prompt replacement. */
export function prepareCodexSystemPrompt(
	options: PiSystemPromptOptions,
	config: PrepareCodexSystemPromptOptions = {},
): void {
	const mode = config.mode ?? "normal";
	const overwrite = config.heavySystemPromptOverwrite ?? false;
	const skills = config.skills ?? [];
	const shell = config.shell;
	const sections = (options.sections ??= {});
	delete sections["codex_runtime"];

	if (options.forceSystemPrompt !== undefined) {
		const guidelines = formatGuidelines(
			mergeCodexGuidelines([], mode, {
				selectedTools: options.selectedTools,
				nestedTools: codeModePromptToolNames(options),
			}),
			shell,
			codeModeCustomizationGuidance(options),
		);
		let forced = upsertOpaqueSection(
			options.forceSystemPrompt,
			"runtime_guidelines",
			guidelines,
		);
		forced = upsertOpaqueSection(forced, "codex_skills", "");
		forced = upsertOpaqueSection(
			forced,
			"skill_catalog",
			buildSkillsContent(skills),
		);
		forced = upsertOpaqueSection(forced, "codex_runtime", "");
		options.forceSystemPrompt = forced;
		return;
	}

	if (overwrite) {
		const preamble = GENERAL_GUIDELINES.join("\n");
		const customPrompt =
			options.customPrompt && options.customPrompt !== preamble;
		if (!customPrompt) options.customPrompt = preamble;
		defineOwnedSection(sections, "runtime_guidelines", () => {
			const contributed = customPrompt
				? []
				: [...selectedToolGuidelines(options), ...options.promptGuidelines];
			const guidelines = mergeCodexGuidelines(contributed, mode, {
				removePiDefaults: true,
				selectedTools: options.selectedTools,
				nestedTools: codeModePromptToolNames(options),
				...(!customPrompt ? { piPackageRoot: getPackageDir() } : {}),
			});
			const sectionGuidelines = customPrompt
				? guidelines
				: guidelines.filter(
						(guideline) =>
							!GENERAL_GUIDELINES.some((general) => general === guideline),
					);
			return formatGuidelines(
				sectionGuidelines,
				shell,
				codeModeCustomizationGuidance(options),
			);
		});
	} else {
		options.promptGuidelines = withoutCodexGuidelines(options.promptGuidelines);
		defineOwnedSection(sections, "runtime_guidelines", () =>
			formatGuidelines(
				mergeCodexGuidelines([], mode, {
					selectedTools: options.selectedTools,
					nestedTools: codeModePromptToolNames(options),
				}),
				shell,
				codeModeCustomizationGuidance(options),
			),
		);
	}

	prepareStructuredSkills(options, skills, mode, overwrite);
}
