import { defineOwnedSection, upsertOpaqueSection } from "./owned-sections.ts";
import type { ExecutionMode } from "../adapter/activation/execution-mode.ts";
import { formatAgentBehaviour } from "./agent-behaviour.ts";
import { formatRuntimeGuidelines } from "./runtime-guidelines.ts";
import {
	getPackageDir,
	type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import { getCodeModePromptCapture } from "../tools/code-mode/custom-tool-prompt.js";

export type PiSystemPromptOptions = NormalizedBuildSystemPromptOptions;

function buildSkillsContent(
	skills: PiSystemPromptOptions["skills"],
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
	shell?: string | undefined;
	executionMode?: ExecutionMode | undefined;
	heavySystemPromptOverwrite?: boolean | undefined;
}

function prepareStructuredSkills(
	options: PiSystemPromptOptions,
	skills: PiSystemPromptOptions["skills"],
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
	const skills = options.skills.filter(
		(skill) => !skill.disableModelInvocation,
	);
	const sections = (options.sections ??= {});
	delete sections["codex_runtime"];
	const behaviour = formatAgentBehaviour(heavySystemPromptOverwrite);
	const renderRuntime = (replacePiScaffold: boolean) => {
		const capture = getCodeModePromptCapture(options);
		return formatRuntimeGuidelines(options, {
			executionMode,
			heavySystemPromptOverwrite,
			replacePiScaffold,
			shell: config.shell,
			nestedTools: capture?.toolNames ?? [],
			customization: capture?.customizationGuidance() ?? "",
			...(replacePiScaffold ? { piPackageRoot: getPackageDir() } : {}),
		});
	};

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
