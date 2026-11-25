import { defineOwnedSection, upsertOpaqueSection } from "./owned-sections.ts";
import type { ExecutionMode } from "../adapter/activation/execution-mode.ts";
import { formatRuntimeGuidelines } from "./runtime-guidelines.ts";
import {
	getPackageDir,
	type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import { getCodeModePromptCapture } from "../tools/code-mode/execution-prompt.js";

export type PiSystemPromptOptions = NormalizedBuildSystemPromptOptions;

const FOLLOW_THROUGH =
	"When execution is in scope, run or assign a check for promising findings. Verify existing equivalents in actual use. If evidence is missing, run the smallest useful test. Try uncertain changes reversibly and keep them only if validation supports them.";
const HEAVY_SYSTEM_PROMPT_OVERWRITE_FOLLOW_THROUGH =
	"Execution in scope: promising finding→own or assign next check. Existing equivalent→verify in use. Evidence missing→smallest useful test. Uncertain change→reversible trial; keep only if validated";
const HEAVY_SYSTEM_PROMPT_OVERWRITE_PREAMBLE = `Pi with Codex tools\n${HEAVY_SYSTEM_PROMPT_OVERWRITE_FOLLOW_THROUGH}`;

function appendGuidance(prompt: string, guidance: string): string {
	if (!prompt) return guidance;
	return prompt.endsWith(guidance) ? prompt : `${prompt}\n\n${guidance}`;
}

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
	const hasVisiblePiReader = () =>
		["read", "bash"].some(
			(name) =>
				options.selectedTools.includes(name) &&
				!options.hiddenTools.includes(name),
		);
	const codexCanReadSkills = () =>
		executionMode === "normal"
			? options.selectedTools.includes("exec_command")
			: options.selectedTools.includes("exec") &&
				options.selectedTools.includes("wait") &&
				(executionMode === "code" ||
					executionMode === "vm" ||
					options.selectedTools.includes("notebook"));
	if (sections["skills"] === undefined) {
		defineOwnedSection(sections, "skills", () =>
			piWillRenderSkills() &&
			(heavySystemPromptOverwrite ||
				(!hasVisiblePiReader() && codexCanReadSkills()))
				? content
				: "",
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
	const followThrough = heavySystemPromptOverwrite
		? HEAVY_SYSTEM_PROMPT_OVERWRITE_FOLLOW_THROUGH
		: FOLLOW_THROUGH;
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
		options.forceSystemPrompt = appendGuidance(forced, followThrough);
		return;
	}

	const replacePiScaffold =
		heavySystemPromptOverwrite &&
		(!options.customPrompt ||
			options.customPrompt === HEAVY_SYSTEM_PROMPT_OVERWRITE_PREAMBLE);
	if (replacePiScaffold) {
		options.customPrompt = HEAVY_SYSTEM_PROMPT_OVERWRITE_PREAMBLE;
	} else if (options.customPrompt) {
		options.appendSystemPrompt = appendGuidance(
			options.appendSystemPrompt,
			followThrough,
		);
	} else if (!options.promptGuidelines.includes(followThrough)) {
		options.promptGuidelines.push(followThrough);
	}
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
