import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

test("buildCodexSystemPrompt appends to Guidelines before Pi documentation with parenthetical", () => {
	const prompt = buildCodexSystemPrompt(`Guidelines:
- Be concise in your responses

Pi documentation (read only when the user asks about pi itself):
- Main documentation: /docs/README.md

Current date: 2026-03-14`);

	assert.equal(prompt.match(/^Guidelines:$/gm)?.length, 1);
	assert.match(prompt, /Guidelines:\n- Be concise in your responses\n- Use exec_command/);
	assert.match(prompt, /\n\nPi documentation \(read only when the user asks about pi itself\):/);
});

test("buildCodexSystemPrompt documents all PATH tools in path mode", () => {
	const prompt = buildCodexSystemPrompt(`Guidelines:
- Be concise

Current date: 2026-03-14`, { mode: "path" });

	assert.match(prompt, /PATH tool accepted forms:/);
	assert.match(prompt, /- apply_patch <<'PATCH'\n  \*\*\* Begin Patch\n  \.\.\.\n  \*\*\* End Patch\n  PATCH/);
	assert.match(prompt, /- view_image '\{"path":"\/x\.png"\}'/);
	assert.match(prompt, /- web_run '\{"search_query":\[\{"q":"\.\.\."\}\],"response_length":"short\|medium\|long"\}'/);
	assert.match(prompt, /- web_run '\{"open":\[\{"ref_id":"turn0search0 or https:\/\/\.\.\."\}\]\}'/);
	assert.match(prompt, /- web_run '\{"click":\[\{"ref_id":"turn0view0","id":1\}\]\}'/);
	assert.match(prompt, /- web_run '\{"find":\[\{"ref_id":"turn0view0","pattern":"\.\.\."\}\]\}'/);
	assert.match(prompt, /- imagegen '\{"prompt":"\.\.\."\}'/);
});

test("buildCodexSystemPrompt injects skill inventory when Pi omitted it", () => {
	const prompt = buildCodexSystemPrompt(
		`You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Guidelines:
- Prefer \`rg\`

Current date: 2026-03-14
Current working directory: /tmp/example-workspace`,
		{
			skills: [
				{
					name: "agent-native-hardening",
					description: "Hardening workflow for JS and TS repos",
					filePath: "/skills/agent-native-hardening/SKILL.md",
				},
			],
		},
	);

	assert.match(prompt, /<skills_instructions>/);
	assert.match(prompt, /^## Skills$/m);
	assert.match(prompt, /^### Available skills$/m);
	assert.match(prompt, /- agent-native-hardening: Hardening workflow for JS and TS repos \(file: \/skills\/agent-native-hardening\/SKILL\.md\)/);
	assert.match(prompt, /^### How to use skills$/m);
	assert.match(prompt, /- Use skill when user names it/);
	assert.match(prompt, /^### Fallback$/m);
	assert.match(prompt, /- If skill is missing or path cannot be read/);
	assert.match(prompt, /<\/skills_instructions>/);
});
