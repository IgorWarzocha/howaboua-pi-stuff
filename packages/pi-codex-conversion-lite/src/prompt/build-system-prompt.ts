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

const NORMAL_CODEX_GUIDELINES = [
	"Use exec_command for shell commands, file inspection, builds, and tests; prefer rg / rg --files for discovery and focused commands over truncation",
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	"Give commands time; back off session polls",
	"Run independent tool calls in parallel when practical",
];

const CODE_MODE_GUIDELINES = [
	"Use tools.exec_command for shell commands; prefer rg and rg --files for search",
	"Keep tools.exec_command cmd valid JavaScript: use String.raw templates only when shell text has no backticks or `${...}`; otherwise use quoted line arrays or split the call",
	"Continue exec cell_id with wait; continue exec_command session_id by calling tools.write_stdin inside exec",
	"Give commands time; back off session polls",
	"Reserve tty=true for input or persistent processes",
	"Use tools.apply_patch(patch) for local file edits; split large patches; reserve shell/Python writes for formatting or bulk rewrites",
	"Compose independent nested calls with Promise.all",
	"With async work, await dependencies; overlap only independent work",
	"Use text() only for concise values needed after exec; do not dump complete nested tool results",
];

const CODE_MODE_REPLACED_GUIDELINES = new Set([
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	"Run independent tool calls in parallel when practical",
]);

const REMOVED_GUIDELINES = new Set([
	"Prefer the apply_patch tool; use shell apply_patch only when chaining edits with other shell steps",
]);

const ALL_STATIC_CODEX_GUIDELINES = [
	...NORMAL_CODEX_GUIDELINES,
	...CODE_MODE_GUIDELINES,
];

function withoutCosmeticTerminalPeriod(value: string): string {
	return value.endsWith(".") && !value.endsWith("..") ? value.slice(0, -1) : value;
}

const STATIC_CODEX_GUIDELINES_BY_KEY = new Map(
	[
		...ALL_STATIC_CODEX_GUIDELINES.map((guideline) => [withoutCosmeticTerminalPeriod(guideline), guideline] as const),
		["Use tty=true for dev servers, watchers, REPLs, and prompts", NORMAL_CODEX_GUIDELINES[1]!],
		["Use tty=true for interactive commands", CODE_MODE_GUIDELINES[4]!],
	],
);

function canonicalizeGuidelineLine(line: string): string {
	const match = line.match(/^(\s*-\s+)(.*)$/);
	if (!match) return line;
	const key = withoutCosmeticTerminalPeriod(match[2]!.trim());
	const canonical = STATIC_CODEX_GUIDELINES_BY_KEY.get(key);
	return canonical ? `${match[1]}${canonical}` : line;
}

type CodexPromptMode = "normal" | "code";

function buildCodexGuidelines(mode: CodexPromptMode = "normal"): string[] {
	if (mode === "normal") return [...NORMAL_CODEX_GUIDELINES];
	return [...CODE_MODE_GUIDELINES];
}

function insertBeforeTrailingContext(prompt: string, section: string): string {
	const currentDateIndex = prompt.lastIndexOf("\nCurrent date:");
	if (currentDateIndex !== -1) {
		return `${prompt.slice(0, currentDateIndex)}\n\n${section}${prompt.slice(currentDateIndex)}`;
	}
	return `${prompt}\n\n${section}`;
}

function injectShell(prompt: string, shell?: string): string {
	if (!shell) {
		return prompt;
	}
	if (/\nCurrent shell:/.test(prompt)) {
		return prompt.replace(/(^Current shell:) .*$/m, `$1 ${shell}`);
	}
	return insertBeforeTrailingContext(prompt, `Current shell: ${shell}`);
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

function injectSkills(prompt: string, skills: PromptSkill[]): string {
	if (skills.length === 0 || /\n## Skills\b/.test(prompt) || /<skills_instructions>/.test(prompt)) {
		return prompt;
	}

	const lines = [
		"<skills_instructions>",
		"## Skills",
		"Skill: local instructions in `SKILL.md` file",
		"### Available skills",
	];

	for (const skill of skills) {
		lines.push(`- ${skill.name}: ${skill.description} (file: ${skill.filePath})`);
	}

	lines.push("### How to use skills");
	lines.push("- Use skill when user names it (`$SkillName` or plain text) or request clearly matches its description");
	lines.push("- Use the minimal required set of skills. If multiple apply, use them together and state the order briefly");
	lines.push("- For each selected skill, open its `SKILL.md`, resolve relative paths from the skill directory first, load only the files you need, and prefer existing scripts/assets/templates over recreating them");
	lines.push("### Fallback");
	lines.push("- If skill is missing or path cannot be read, say so briefly and continue with best fallback approach");
	lines.push("</skills_instructions>");

	return insertBeforeTrailingContext(prompt, lines.join("\n"));
}

function injectGuidelines(prompt: string, mode?: CodexPromptMode): string {
	const match = prompt.match(/(^Guidelines:\n)([\s\S]*?)(\n\n(?=Pi documentation\b|# Project Context|# Skills|Current date:))/m);
	if (!match || match.index === undefined) {
		const fallbackSection = `Guidelines:\n${buildCodexGuidelines(mode).map((line) => `- ${line}`).join("\n")}`;
		return insertBeforeTrailingContext(prompt, fallbackSection);
	}

	const [, header, body, suffix] = match as RegExpMatchArray & { 1: string; 2: string; 3: string };
	const bodyLines = body.split("\n");
	const canonicalBodyLines = bodyLines.map(canonicalizeGuidelineLine);
	const withoutRemoved = canonicalBodyLines.filter((line) => !REMOVED_GUIDELINES.has(withoutCosmeticTerminalPeriod(line.trim().replace(/^-\s*/, ""))));
	const keptBodyLines = mode === "code"
		? withoutRemoved.filter((line) => !CODE_MODE_REPLACED_GUIDELINES.has(withoutCosmeticTerminalPeriod(line.trim().replace(/^-\s*/, ""))))
		: withoutRemoved;
	const existingLines = keptBodyLines
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "));
	const existing = new Set(existingLines.map((line) => line.slice(2)));
	const additions = buildCodexGuidelines(mode).filter((line) => !existing.has(line)).map((line) => `- ${line}`);
	if (additions.length === 0 && keptBodyLines.join("\n") === body) {
		return prompt;
	}

	const normalizedBody = keptBodyLines.join("\n").trimEnd();
	const replacement = `${header}${normalizedBody}\n${additions.join("\n")}${suffix}`;
	return `${prompt.slice(0, match.index)}${replacement}${prompt.slice(match.index + match[0]!.length)}`;
}

export function buildCodexSystemPrompt(basePrompt: string, options: { skills?: PromptSkill[] | undefined; shell?: string | undefined; mode?: CodexPromptMode | undefined } = {}): string {
	return injectShell(injectSkills(injectGuidelines(basePrompt, options.mode), options.skills ?? []), options.shell);
}
