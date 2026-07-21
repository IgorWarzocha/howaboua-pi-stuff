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
	"Use tty=true for dev servers, watchers, REPLs, and prompts",
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	"Prefer the apply_patch tool; use shell apply_patch only when chaining edits with other shell steps",
	"Use write_stdin only for running exec_command sessions; poll sparingly",
	"Run independent tool calls in parallel when practical",
];

const PATH_CODEX_GUIDELINES = [
	"Use exec_command for shell/file/build/test; prefer rg/rg --files",
	"Use tty=true for interactive commands",
	"Use apply_patch for file edits; order each file's hunks top-to-bottom; indentation is literal",
	"Do not probe listed PATH tools",
	"Use stdin/heredoc for quoted or multiline PATH args",
	"Chain dependent shell commands with &&",
	"Run independent exec_command calls in parallel when practical",
];

const CODE_MODE_GUIDELINES = [
	"Use tools.exec_command for shell commands; prefer rg and rg --files for search",
	"When calling tools.exec_command from JavaScript, String.raw`...` only avoids JavaScript backslash escapes; it does not shell-escape",
	"Continue exec cell_id with wait; continue exec_command session_id by calling tools.write_stdin inside exec",
	"Wait proportionally to expected runtime; back off repeated polls",
	"Use tty=true for interactive commands",
	"Use tools.apply_patch(patch) for file edits; split oversized patches",
	"Compose independent nested calls with Promise.all",
	"With async work, await dependencies; overlap only independent work",
	"Use text() only for concise values needed after exec; do not dump complete nested tool results",
];

const PATH_MODE_REMOVED_GUIDELINES = new Set([
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	"Prefer the apply_patch tool; use shell apply_patch only when chaining edits with other shell steps",
	"Run independent tool calls in parallel when practical",
]);

const ALL_STATIC_CODEX_GUIDELINES = [
	...NORMAL_CODEX_GUIDELINES,
	...PATH_CODEX_GUIDELINES,
	...CODE_MODE_GUIDELINES,
];

function withoutCosmeticTerminalPeriod(value: string): string {
	return value.endsWith(".") && !value.endsWith("..") ? value.slice(0, -1) : value;
}

const STATIC_CODEX_GUIDELINES_BY_KEY = new Map(
	ALL_STATIC_CODEX_GUIDELINES.map((guideline) => [withoutCosmeticTerminalPeriod(guideline), guideline]),
);

function canonicalizeGuidelineLine(line: string): string {
	const match = line.match(/^(\s*-\s+)(.*)$/);
	if (!match) return line;
	const key = withoutCosmeticTerminalPeriod(match[2]!.trim());
	const canonical = STATIC_CODEX_GUIDELINES_BY_KEY.get(key);
	return canonical ? `${match[1]}${canonical}` : line;
}

export interface CodexPromptToolOptions {
	viewImage?: boolean | undefined;
	webRun?: boolean | undefined;
	imageGeneration?: boolean | undefined;
}

type CodexPromptMode = "normal" | "path" | "code";

function buildCodexGuidelines(mode: CodexPromptMode = "normal", tools: CodexPromptToolOptions = {}): string[] {
	if (mode === "normal") return [...NORMAL_CODEX_GUIDELINES];
	const guidelines = mode === "code" ? [...CODE_MODE_GUIDELINES] : [...PATH_CODEX_GUIDELINES];
	if (mode === "code") return guidelines;
	const examples = [`- apply_patch <<'PATCH'`, `  *** Begin Patch`, `  ...`, `  *** End Patch`, `  PATCH`];
	if (tools.viewImage !== false) examples.push(`- view_image '{"path":"/x.png"}'`);
	if (tools.webRun !== false) {
		examples.push(`- web_run '{"search_query":[{"q":"..."}],"response_length":"short|medium|long"}'`);
		examples.push(`- web_run '{"open":[{"ref_id":"turn0search0 or https://..."}]}'`);
		examples.push(`- web_run '{"click":[{"ref_id":"turn0view0","id":1}]}'`);
		examples.push(`- web_run '{"find":[{"ref_id":"turn0view0","pattern":"..."}]}'`);
	}
	if (tools.imageGeneration !== false) {
		examples.push(`- imagegen '{"prompt":"..."}'`);
		examples.push(`- imagegen '{"action":"edit","prompt":"...","images":["https://... or /x.png"]}'`);
	}
	if (examples.length > 0)
		guidelines.splice(4, 0, `PATH tool accepted forms:\n${examples.join("\n")}`);
	return guidelines;
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

function injectGuidelines(prompt: string, mode?: CodexPromptMode, tools?: CodexPromptToolOptions): string {
	const match = prompt.match(/(^Guidelines:\n)([\s\S]*?)(\n\n(?=Pi documentation\b|# Project Context|# Skills|Current date:))/m);
	if (!match || match.index === undefined) {
		const fallbackSection = `Guidelines:\n${buildCodexGuidelines(mode, tools).map((line) => `- ${line}`).join("\n")}`;
		return insertBeforeTrailingContext(prompt, fallbackSection);
	}

	const [, header, body, suffix] = match as RegExpMatchArray & { 1: string; 2: string; 3: string };
	const bodyLines = body.split("\n");
	const canonicalBodyLines = bodyLines.map(canonicalizeGuidelineLine);
	const keptBodyLines = mode === "path" || mode === "code"
		? canonicalBodyLines.filter((line) => !PATH_MODE_REMOVED_GUIDELINES.has(withoutCosmeticTerminalPeriod(line.trim().replace(/^-\s*/, ""))))
		: canonicalBodyLines;
	const existingLines = keptBodyLines
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "));
	const existing = new Set(existingLines.map((line) => line.slice(2)));
	const additions = buildCodexGuidelines(mode, tools).filter((line) => !existing.has(line)).map((line) => `- ${line}`);
	if (additions.length === 0 && keptBodyLines.join("\n") === body) {
		return prompt;
	}

	const normalizedBody = keptBodyLines.join("\n").trimEnd();
	const replacement = `${header}${normalizedBody}\n${additions.join("\n")}${suffix}`;
	return `${prompt.slice(0, match.index)}${replacement}${prompt.slice(match.index + match[0]!.length)}`;
}

export function buildCodexSystemPrompt(basePrompt: string, options: { skills?: PromptSkill[] | undefined; shell?: string | undefined; mode?: CodexPromptMode | undefined; tools?: CodexPromptToolOptions | undefined } = {}): string {
	return injectShell(injectSkills(injectGuidelines(basePrompt, options.mode, options.tools), options.skills ?? []), options.shell);
}
