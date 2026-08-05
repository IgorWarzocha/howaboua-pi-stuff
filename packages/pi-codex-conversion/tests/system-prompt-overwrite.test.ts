import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

const PI_INTRO_QUOTE = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

const basePrompt = `Third-party preface

You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- exec: Compose tools with JavaScript
- wait: Resume or terminate an exec cell

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Be concise in your responses
- Show file paths clearly when working with files
- Third-party registered guidance

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /opt/pi/packages/coding-agent/README.md
- Additional docs: /opt/pi/packages/coding-agent/docs
- Examples: /opt/pi/packages/coding-agent/examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

Appended instructions

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="/repo/AGENTS.md">
Project instructions
</project_instructions>

</project_context>

The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>release</name>
    <description>Ship releases</description>
    <location>/skills/release/SKILL.md</location>
  </skill>
</available_skills>

Current working directory: /old

Tools available in exec:
- await tools.exec_command({ cmd: string })

<third_party_context>preserve exactly</third_party_context>

Current date: 2026-03-21

<workflows>third-party workflow hook</workflows>`;

test("heavy prompt overwrite removes Pi scaffold and preserves dynamic instructions", () => {
	assert.equal(DEFAULT_CODEX_CONVERSION_CONFIG.prompt.heavySystemPromptOverwrite, false);

	const prompt = buildCodexSystemPrompt(basePrompt, {
		mode: "code",
		shell: "/bin/zsh",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: {
			selectedTools: ["exec", "wait"],
			toolSnippets: { exec: "Compose tools with JavaScript", wait: "Resume or terminate an exec cell" },
			appendSystemPrompt: "Appended instructions",
			cwd: String.raw`C:\work\repo`,
			contextFiles: [{ path: "/repo/AGENTS.md", content: "Project instructions" }],
		},
		skills: [{ name: "release", description: "Ship releases", filePath: "/skills/release/SKILL.md" }],
	});

	assert.doesNotMatch(prompt, /expert coding assistant|Available tools:\n- exec:|Be concise|The following skills provide/);
	assert.match(
		prompt,
		/When work depends on Pi APIs or runtime behavior not established in the current repository, consult the relevant README\.md, docs\/, or examples\/ files under \/opt\/pi\/packages\/coding-agent/,
	);
	assert.match(prompt, /^Third-party preface\n\nGuidelines:/);
	assert.match(prompt, /- Third-party registered guidance/);
	assert.match(prompt, /Appended instructions/);
	assert.match(prompt, /<project_instructions path="\/repo\/AGENTS\.md">\nProject instructions/);
	assert.match(prompt, /- release: Ship releases \(file: \/skills\/release\/SKILL\.md\)/);
	assert.match(prompt, /Tools available in exec:\n- await tools\.exec_command/);
	assert.match(prompt, /<third_party_context>preserve exactly<\/third_party_context>/);
	assert.match(prompt, /<workflows>third-party workflow hook<\/workflows>/);
	assert.match(prompt, /Current working directory: C:\/work\/repo/);
	assert.match(prompt, /Current shell: \/bin\/zsh; follow its syntax, quoting, and variable rules\nDate: 2026-03/);
	assert.doesNotMatch(prompt, /2026-03-21/);
});

test("heavy prompt overwrite leaves explicit custom prompts authoritative", () => {
	const prompt = buildCodexSystemPrompt("My system prompt\n\nEarlier hook output\nCurrent working directory: /old", {
		mode: "normal",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: {
			customPrompt: "My system prompt",
			cwd: "/repo",
		},
	});

	assert.match(prompt, /^My system prompt\n\nEarlier hook output\n\nGuidelines:/);
	assert.doesNotMatch(prompt, /For questions about Pi|Pi documentation/);
});

test("heavy prompt overwrite can strip Pi tool scaffold from context-only options", () => {
	const prompt = buildCodexSystemPrompt(basePrompt, {
		mode: "code",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: { cwd: "/repo" },
	});

	assert.doesNotMatch(prompt, /expert coding assistant|Available tools:\n- exec:/);
	assert.match(prompt, /Tools available in exec:\n- await tools\.exec_command/);
	assert.match(prompt, /Current working directory: \/repo/);
});

test("heavy prompt overwrite preserves extension instructions interleaved with Pi tools", () => {
	const interleaved = basePrompt
		.replace(
			"Available tools:\n- exec: Compose tools with JavaScript\n- wait: Resume or terminate an exec cell",
			"Available tools:\n- exec: Compose tools with JavaScript\nExtension instruction inside Pi tools\n- exec: Extension-owned guidance for exec\n- wait: Resume or terminate an exec cell\n- Never remove this extension rule",
		);
	const prompt = buildCodexSystemPrompt(interleaved, {
		mode: "code",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: { cwd: "/repo" },
	});

	assert.doesNotMatch(prompt, /expert coding assistant|Available tools:\n|- exec: Compose|- wait: Resume/);
	assert.match(prompt, /Extension instruction inside Pi tools/);
	assert.match(prompt, /- exec: Extension-owned guidance for exec/);
	assert.match(prompt, /- Never remove this extension rule/);
});

test("heavy prompt fallback leaves ambiguous repeated Pi scaffolds untouched", () => {
	const prompt = buildCodexSystemPrompt(`${PI_INTRO_QUOTE}\n\n${basePrompt}`, {
		mode: "code",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: { cwd: "/repo" },
	});

	assert.ok(prompt.includes(PI_INTRO_QUOTE));
	assert.match(prompt, /Available tools:\n- exec: Compose tools with JavaScript/);
});
