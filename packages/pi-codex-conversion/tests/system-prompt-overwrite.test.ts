import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

const basePrompt = `You are an expert coding assistant operating inside pi.

Available tools:
- exec: Compose tools with JavaScript
- wait: Resume or terminate an exec cell

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself):
- Main documentation: /opt/pi/packages/coding-agent/README.md
- Additional docs: /opt/pi/packages/coding-agent/docs
- Examples: /opt/pi/packages/coding-agent/examples
- exhaustive catalogue
Current working directory: /old

Tools available in exec:
- await tools.exec_command({ cmd: string })

Current date: 2026-03-21`;

test("heavy prompt overwrite removes Pi scaffold and preserves dynamic instructions", () => {
	assert.equal(DEFAULT_CODEX_CONVERSION_CONFIG.prompt.heavySystemPromptOverwrite, false);

	const prompt = buildCodexSystemPrompt(basePrompt, {
		mode: "code",
		shell: "/bin/zsh",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: {
			appendSystemPrompt: "Appended instructions",
			cwd: String.raw`C:\work\repo`,
			contextFiles: [{ path: "/repo/AGENTS.md", content: "Project instructions" }],
		},
		skills: [{ name: "release", description: "Ship releases", filePath: "/skills/release/SKILL.md" }],
	});

	assert.doesNotMatch(prompt, /expert coding assistant|Available tools:\n- exec:|exhaustive catalogue|Be concise/);
	assert.match(
		prompt,
		/For questions about Pi, Pi configuration, or anything built with its SDK, first list README\.md, docs\/, and examples\/ under \/opt\/pi\/packages\/coding-agent/,
	);
	assert.match(prompt, /^Appended instructions\n\nGuidelines:/);
	assert.match(prompt, /<project_instructions path="\/repo\/AGENTS\.md">\nProject instructions/);
	assert.match(prompt, /- release: Ship releases \(file: \/skills\/release\/SKILL\.md\)/);
	assert.match(prompt, /Tools available in exec:\n- await tools\.exec_command/);
	assert.match(prompt, /Date: 2026-03\n\nCurrent working directory: C:\/work\/repo\n\nCurrent shell: \/bin\/zsh$/);
	assert.doesNotMatch(prompt, /2026-03-21/);
});

test("heavy prompt overwrite leaves explicit custom prompts authoritative", () => {
	const prompt = buildCodexSystemPrompt(basePrompt, {
		mode: "normal",
		heavySystemPromptOverwrite: true,
		systemPromptOptions: {
			customPrompt: "My system prompt",
			cwd: "/repo",
		},
	});

	assert.match(prompt, /^My system prompt\n\nGuidelines:/);
	assert.doesNotMatch(prompt, /For questions about Pi|Pi documentation/);
});
