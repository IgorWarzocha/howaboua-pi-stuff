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

export interface PiSystemPromptOptions {
	customPrompt?: string | undefined;
	appendSystemPrompt?: string | undefined;
	cwd: string;
	contextFiles?: Array<{ path: string; content: string }> | undefined;
}

const NORMAL_CODEX_GUIDELINES = [
	"Use exec_command for shell commands, file inspection, builds, and tests; prefer rg / rg --files for discovery and focused commands over truncation",
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	"Give commands time; back off session polls",
	"Run independent tool calls in parallel when practical",
];

const CODE_MODE_GUIDELINES = [
	"Use tools.exec_command for shell commands; prefer rg and rg --files",
	"Use String.raw for cmd only when shell text has no backticks or ${}; otherwise use quoted lines or split the call",
	"Continue exec cell_id with wait; continue exec_command session_id with tools.write_stdin",
	"Give commands time; back off polls; use tty=true only for input or persistent processes",
	"Use tools.apply_patch(patch) for file edits; split large patches; reserve shell/Python for formatting or bulk rewrites",
	"Await dependencies; use Promise.all for independent calls",
	"Use text() only for concise final output",
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
		["Use tty=true for interactive commands", NORMAL_CODEX_GUIDELINES[1]!],
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

function buildCodexGuidelines(mode: CodexPromptMode = "normal", piPackageRoot?: string): string[] {
	const guidelines = mode === "normal" ? [...NORMAL_CODEX_GUIDELINES] : [...CODE_MODE_GUIDELINES];
	if (piPackageRoot) {
		guidelines.push(`For questions about Pi, Pi configuration, or anything built with its SDK, first list README.md, docs/, and examples/ under ${piPackageRoot}; read relevant files and follow references before implementing`);
	}
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

function buildSkillsSection(skills: PromptSkill[]): string {
	if (skills.length === 0) return "";
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
	return lines.join("\n");
}

function injectSkills(prompt: string, skills: PromptSkill[]): string {
	if (skills.length === 0 || /\n## Skills\b/.test(prompt) || /<skills_instructions>/.test(prompt)) {
		return prompt;
	}
	return insertBeforeTrailingContext(prompt, buildSkillsSection(skills));
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
	const replacement = `${header}${normalizedBody}${normalizedBody ? "\n" : ""}${additions.join("\n")}${suffix}`;
	return `${prompt.slice(0, match.index)}${replacement}${prompt.slice(match.index + match[0]!.length)}`;
}

function extractPiPackageRoot(prompt: string): string | undefined {
	const readmePath = prompt.match(/^- Main documentation: (.+[\\/]README\.md)$/m)?.[1]?.trim();
	return readmePath?.replace(/[\\/][^\\/]+$/, "");
}

function extractCurrentMonth(prompt: string): string | undefined {
	const month = prompt.match(/^Current date:\s*(\d{4}-\d{2})/m)?.[1];
	return month ? `Date: ${month}` : undefined;
}

function extractCodeModeToolsSection(prompt: string): string | undefined {
	const start = prompt.indexOf("\n\nTools available in exec:");
	if (start === -1) return undefined;
	const section = prompt.slice(start + 2);
	const endMarkers = ["\nCurrent date:", "\nCurrent shell:"]
		.map((marker) => section.indexOf(marker))
		.filter((index) => index !== -1);
	return section.slice(0, endMarkers.length > 0 ? Math.min(...endMarkers) : undefined).trimEnd();
}

function buildProjectContext(contextFiles: PiSystemPromptOptions["contextFiles"]): string | undefined {
	if (!contextFiles || contextFiles.length === 0) return undefined;
	const files = contextFiles
		.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`)
		.join("\n\n");
	return `<project_context>\n\nProject-specific instructions and guidelines:\n\n${files}\n\n</project_context>`;
}

function buildHeavyCodexSystemPrompt(
	basePrompt: string,
	options: {
		skills: PromptSkill[];
		shell?: string | undefined;
		mode?: CodexPromptMode | undefined;
		systemPromptOptions: PiSystemPromptOptions;
	},
): string {
	const source = options.systemPromptOptions;
	const sections = [
		source.customPrompt,
		source.appendSystemPrompt,
		`Guidelines:\n${buildCodexGuidelines(options.mode, source.customPrompt ? undefined : extractPiPackageRoot(basePrompt)).map((line) => `- ${line}`).join("\n")}`,
		buildProjectContext(source.contextFiles),
		buildSkillsSection(options.skills),
		extractCodeModeToolsSection(basePrompt),
		extractCurrentMonth(basePrompt),
		`Current working directory: ${source.cwd.replace(/\\/g, "/")}`,
		options.shell ? `Current shell: ${options.shell}` : undefined,
	].filter((section): section is string => Boolean(section));
	return sections.join("\n\n");
}

export function buildCodexSystemPrompt(
	basePrompt: string,
	options: {
		skills?: PromptSkill[] | undefined;
		shell?: string | undefined;
		mode?: CodexPromptMode | undefined;
		heavySystemPromptOverwrite?: boolean | undefined;
		systemPromptOptions?: PiSystemPromptOptions | undefined;
	} = {},
): string {
	if (options.heavySystemPromptOverwrite && options.systemPromptOptions) {
		return buildHeavyCodexSystemPrompt(basePrompt, {
			skills: options.skills ?? [],
			shell: options.shell,
			mode: options.mode,
			systemPromptOptions: options.systemPromptOptions,
		});
	}
	return injectShell(injectSkills(injectGuidelines(basePrompt, options.mode), options.skills ?? []), options.shell);
}
