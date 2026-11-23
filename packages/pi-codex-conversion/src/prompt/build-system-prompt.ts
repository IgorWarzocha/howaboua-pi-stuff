import type { ExecutionMode } from "../adapter/activation/execution-mode.ts";
import { formatAgentBehaviour } from "./agent-behaviour.ts";
import { formatRuntimeGuidelines } from "./runtime-guidelines.ts";
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

function buildSkillsContent(
	skills: PromptSkill[],
	heavySystemPromptOverwrite: boolean,
): string {
	if (skills.length === 0) return "";
	const lines = [
		heavySystemPromptOverwrite
			? "Read named or task-matching skills; relative paths→skill directory; load needed references"
			: "Read skills named by the user or relevant to the task. Resolve relative paths from the skill directory and read any references you need.",
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
	executionMode?: ExecutionMode | undefined;
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
	executionMode: ExecutionMode,
	heavySystemPromptOverwrite: boolean,
): void {
	const sections = (options.sections ??= {});
	const content = buildSkillsContent(skills, heavySystemPromptOverwrite);
	delete sections["codex_skills"];
	if (!content) {
		delete sections["skill_catalog"];
		return;
	}
	const piWillRenderSkills = () =>
		options.selectedTools.includes("read") ||
		options.selectedTools.includes("bash");
	const codexCanReadSkills = () =>
		executionMode === "normal"
			? options.selectedTools.includes("exec_command")
			: options.selectedTools.includes("exec") &&
				options.selectedTools.includes("wait") &&
				(executionMode === "code" ||
					executionMode === "vm" ||
					options.selectedTools.includes("notebook"));
	if (heavySystemPromptOverwrite && sections["skills"] === undefined) {
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
	const executionMode = config.executionMode ?? "normal";
	const heavySystemPromptOverwrite = config.heavySystemPromptOverwrite ?? false;
	const skills = config.skills ?? [];
	const sections = (options.sections ??= {});
	delete sections["codex_runtime"];
	const behaviour = formatAgentBehaviour(heavySystemPromptOverwrite);
	const renderRuntime = (replacePiScaffold: boolean) =>
		formatRuntimeGuidelines(options, {
			executionMode,
			heavySystemPromptOverwrite,
			replacePiScaffold,
			shell: config.shell,
			nestedTools: codeModePromptToolNames(options),
			customization: codeModeCustomizationGuidance(options),
			...(replacePiScaffold ? { piPackageRoot: getPackageDir() } : {}),
		});

	if (options.forceSystemPrompt !== undefined) {
		let forced = upsertOpaqueSection(
			options.forceSystemPrompt,
			"pcc_agent_behaviour",
			behaviour,
		);
		forced = upsertOpaqueSection(
			forced,
			"runtime_guidelines",
			renderRuntime(false),
		);
		forced = upsertOpaqueSection(forced, "codex_skills", "");
		forced = upsertOpaqueSection(
			forced,
			"skill_catalog",
			buildSkillsContent(skills, heavySystemPromptOverwrite),
		);
		forced = upsertOpaqueSection(forced, "codex_runtime", "");
		options.forceSystemPrompt = forced;
		return;
	}

	const replacePiScaffold =
		heavySystemPromptOverwrite &&
		(!options.customPrompt || options.customPrompt === behaviour);
	if (replacePiScaffold) {
		options.customPrompt = behaviour;
		delete sections["pcc_agent_behaviour"];
	} else sections["pcc_agent_behaviour"] = behaviour;
	defineOwnedSection(sections, "runtime_guidelines", () =>
		renderRuntime(replacePiScaffold),
	);

	prepareStructuredSkills(
		options,
		skills,
		executionMode,
		heavySystemPromptOverwrite,
	);
}
