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
	selectedTools?: string[] | undefined;
	toolSnippets?: Record<string, string> | undefined;
	promptGuidelines?: string[] | undefined;
	appendSystemPrompt?: string | undefined;
	cwd: string;
	contextFiles?: Array<{ path: string; content: string }> | undefined;
}

const PI_DEFAULT_INTRO = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const PI_CUSTOM_TOOLS_NOTE = "In addition to the tools above, you may have access to other custom tools depending on the project.";
const PI_DEFAULT_GUIDELINES = new Set([
	"Use bash for file operations like ls, rg, find",
	"Be concise in your responses",
	"Show file paths clearly when working with files",
]);

const EXEC_SESSION_GUIDELINE = "For unfinished exec_command sessions, use write_stdin with yield_time_ms near the command's expected remaining time and lengthen later waits";

const NORMAL_CODEX_GUIDELINES = [
	"Use exec_command for shell commands, file inspection, builds, and tests; prefer rg / rg --files for discovery and focused commands over truncation",
	"Reserve tty=true for input or persistent processes",
	"Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches",
	EXEC_SESSION_GUIDELINE,
	"Run independent tool calls in parallel when practical",
];

const CODE_MODE_GUIDELINES = [
	"Use tools.exec_command for shell commands; prefer rg and rg --files",
	"Use String.raw for cmd only when shell text has no backticks or ${}; otherwise use quoted lines or split the call",
	"Long command: keep tools.exec_command awaited inside exec; resume the yielded cell_id with wait near completion. Do not request a short child yield and poll its session_id with tools.write_stdin",
	"Use tty=true only for input or persistent processes",
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
		guidelines.push(`When work depends on Pi APIs or runtime behavior not established in the current repository, consult the relevant README.md, docs/, or examples/ files under ${piPackageRoot} and follow their references before implementing`);
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
	const shellContext = `Current shell: ${shell}; follow its syntax, quoting, and variable rules`;
	if (/\nCurrent shell:/.test(prompt)) {
		return prompt.replace(/^Current shell:.*$/m, shellContext);
	}
	return insertBeforeTrailingContext(prompt, shellContext);
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

function stripPiToolScaffold(prompt: string, options: PiSystemPromptOptions): string {
	const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => Boolean(options.toolSnippets?.[name]));
	const toolsList = visibleTools.length > 0
		? visibleTools.map((name) => `- ${name}: ${options.toolSnippets![name]}`).join("\n")
		: "(none)";
	const scaffold = `${PI_DEFAULT_INTRO}\n\nAvailable tools:\n${toolsList}\n\n${PI_CUSTOM_TOOLS_NOTE}`;
	return prompt.includes(scaffold) ? prompt.replace(scaffold, "").trimStart() : prompt;
}

function stripPiDocumentation(prompt: string): string {
	const readmePath = prompt.match(/^- Main documentation: (.+[\\/]README\.md)$/m)?.[1]?.trim();
	const docsPath = prompt.match(/^- Additional docs: (.+)$/m)?.[1]?.trim();
	const examplesPath = prompt.match(/^- Examples: (.+) \(extensions, custom tools, SDK\)$/m)?.[1]?.trim();
	if (!readmePath || !docsPath || !examplesPath) return prompt;
	const block = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
	return prompt.includes(block) ? prompt.replace(block, "").replace(/\n{3,}/g, "\n\n").trim() : prompt;
}

function replaceHeavyGuidelines(prompt: string, guidelines: string[]): string {
	const match = prompt.match(/(^Guidelines:\n)([\s\S]*?)(?=\n\n(?:Pi documentation\b|<project_context>|The following skills\b|<skills_instructions>|<available_skills>|Current working directory:|Current date:))/m);
	const additions = guidelines.map((line) => `- ${line}`);
	if (!match || match.index === undefined) {
		const section = `Guidelines:\n${additions.join("\n")}`;
		const markers = ["\n\n<project_context>", "\n\nThe following skills", "\n\n<skills_instructions>", "\n\n<available_skills>", "\nCurrent working directory:"]
			.map((marker) => prompt.indexOf(marker))
			.filter((index) => index !== -1);
		const insertAt = markers.length > 0 ? Math.min(...markers) : prompt.length;
		return `${prompt.slice(0, insertAt).trimEnd()}\n\n${section}\n${prompt.slice(insertAt)}`;
	}
	const kept = match[2]!.split("\n")
		.map(canonicalizeGuidelineLine)
		.filter((line) => !PI_DEFAULT_GUIDELINES.has(withoutCosmeticTerminalPeriod(line.trim().replace(/^-\s*/, ""))));
	const existing = new Set(kept.map((line) => line.trim().replace(/^-\s*/, "")));
	const merged = [...kept, ...additions.filter((line) => !existing.has(line.slice(2)))].join("\n");
	const replacement = `${match[1]}${merged}`;
	return `${prompt.slice(0, match.index)}${replacement}${prompt.slice(match.index + match[0]!.length)}`;
}

function replaceSkills(prompt: string, skills: PromptSkill[]): string {
	const compact = buildSkillsSection(skills);
	const availableStart = prompt.indexOf("<available_skills>");
	if (availableStart !== -1) {
		const preambleStart = prompt.lastIndexOf("\n\nThe following skills provide specialized instructions for specific tasks.", availableStart);
		const sectionStart = preambleStart === -1 ? availableStart : preambleStart;
		const close = "</available_skills>";
		const sectionEnd = prompt.indexOf(close, availableStart);
		if (sectionEnd !== -1) {
			return `${prompt.slice(0, sectionStart).trimEnd()}${compact ? `\n\n${compact}` : ""}${prompt.slice(sectionEnd + close.length)}`;
		}
	}
	const compactStart = prompt.indexOf("<skills_instructions>");
	if (compactStart !== -1) {
		const close = "</skills_instructions>";
		const sectionEnd = prompt.indexOf(close, compactStart);
		if (sectionEnd !== -1) {
			return `${prompt.slice(0, compactStart).trimEnd()}${compact ? `\n\n${compact}` : ""}${prompt.slice(sectionEnd + close.length)}`;
		}
	}
	if (!compact) return prompt;
	const cwdIndex = prompt.indexOf("\nCurrent working directory:");
	const insertAt = cwdIndex === -1 ? prompt.length : cwdIndex;
	return `${prompt.slice(0, insertAt).trimEnd()}\n\n${compact}${prompt.slice(insertAt)}`;
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
	let prompt = stripPiToolScaffold(basePrompt, source);
	const piPackageRoot = !source.customPrompt && stripPiDocumentation(prompt) !== prompt
		? extractPiPackageRoot(prompt)
		: undefined;
	prompt = replaceHeavyGuidelines(prompt, buildCodexGuidelines(options.mode, piPackageRoot));
	prompt = stripPiDocumentation(prompt);
	prompt = replaceSkills(prompt, options.skills);
	prompt = injectShell(prompt, options.shell);
	prompt = prompt.replace(/^Current date:\s*(\d{4}-\d{2}).*$/m, "Date: $1");
	const cwd = `Current working directory: ${source.cwd.replace(/\\/g, "/")}`;
	prompt = /^Current working directory:.*$/m.test(prompt)
		? prompt.replace(/^Current working directory:.*$/m, cwd)
		: `${prompt.trimEnd()}\n\n${cwd}`;
	return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

// Sole owner of Pi-Codex core system-prompt construction; see this directory's AGENTS.md.
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
