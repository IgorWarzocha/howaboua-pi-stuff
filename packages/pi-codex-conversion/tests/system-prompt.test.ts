import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexSystemPrompt, extractPiPromptSkills, promptSkillsFromStructuredSkills, resolvePromptSkills } from "../src/prompt/build-system-prompt.ts";

test("buildCodexSystemPrompt appends to Guidelines before Pi documentation with parenthetical", () => {
	const prompt = buildCodexSystemPrompt(`Guidelines:
- Be concise in your responses

Pi documentation (read only when the user asks about pi itself):
- Main documentation: /docs/README.md

Current date: 2026-03-14`);

	assert.equal(prompt.match(/^Guidelines:$/gm)?.length, 1);
	assert.match(prompt, /Guidelines:\n- Be concise in your responses\n- Use `exec_command`/);
	assert.match(prompt, /\n\nPi documentation \(read only when the user asks about pi itself\):/);
});

test("buildCodexSystemPrompt inserts fallback Guidelines when the base prompt has no Guidelines section", () => {
	const prompt = buildCodexSystemPrompt(`Custom prompt\n\nCurrent date: 2026-03-14\nCurrent working directory: /tmp/example-workspace`, {
		shell: "/bin/zsh",
	});

	assert.match(prompt, /^Guidelines:$/m);
	assert.doesNotMatch(prompt, /Codex mode guidelines:/);
	assert.match(prompt, /^Current shell: \/bin\/zsh$/m);
	assert.match(prompt, /^Current date: 2026-03-14$/m);
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
	assert.match(prompt, /- Use a skill when the user names it/);
	assert.match(prompt, /^### Fallback$/m);
	assert.match(prompt, /- If a skill is missing or its path cannot be read/);
	assert.match(prompt, /<\/skills_instructions>/);
});

test("buildCodexSystemPrompt rewrites an existing shell line to the adapter shell", () => {
	const prompt = buildCodexSystemPrompt(
		`Prompt

Current shell: /bin/bash
Current date: 2026-03-14
Current working directory: /tmp/example-workspace`,
		{ shell: "/bin/zsh" },
	);

	assert.equal(prompt.match(/^Current shell:/gm)?.length, 1);
	assert.match(prompt, /^Current shell: \/bin\/zsh$/m);
});

test("buildCodexSystemPrompt rewrites fish shell lines to bash when codex mode forces bash", () => {
	const prompt = buildCodexSystemPrompt(
		`Prompt

Current shell: /usr/bin/fish
Current date: 2026-03-14
Current working directory: /tmp/example-workspace`,
		{ shell: "/bin/bash" },
	);

	assert.equal(prompt.match(/^Current shell:/gm)?.length, 1);
	assert.match(prompt, /^Current shell: \/bin\/bash$/m);
});

test("extractPiPromptSkills reads Pi-style available_skills inventory", () => {
	const skills = extractPiPromptSkills(`Prefix

<available_skills>
  <skill>
    <name>agent-native-hardening</name>
    <description>Hardening workflow for JS &amp; TS repos</description>
    <location>/skills/agent-native-hardening/SKILL.md</location>
  </skill>
</available_skills>

Suffix`);

	assert.deepEqual(skills, [
		{
			name: "agent-native-hardening",
			description: "Hardening workflow for JS & TS repos",
			filePath: "/skills/agent-native-hardening/SKILL.md",
		},
	]);
});

test("promptSkillsFromStructuredSkills maps Pi skills and skips explicit invocation-only skills", () => {
	const skills = promptSkillsFromStructuredSkills([
		{
			name: "agent-native-hardening",
			description: "Hardening workflow for JS and TS repos",
			filePath: "/skills/agent-native-hardening/SKILL.md",
		},
		{
			name: "manual-only",
			description: "Only loaded by explicit command",
			filePath: "/skills/manual-only/SKILL.md",
			disableModelInvocation: true,
		},
	]);

	assert.deepEqual(skills, [
		{
			name: "agent-native-hardening",
			description: "Hardening workflow for JS and TS repos",
			filePath: "/skills/agent-native-hardening/SKILL.md",
		},
	]);
});

test("promptSkillsFromStructuredSkills returns empty when structured skills are unavailable", () => {
	assert.deepEqual(promptSkillsFromStructuredSkills(undefined), []);
});

test("resolvePromptSkills uses structured empty lists instead of stale fallback skills", () => {
	const fallback = [
		{
			name: "stale-skill",
			description: "No longer loaded",
			filePath: "/skills/stale-skill/SKILL.md",
		},
	];

	assert.deepEqual(resolvePromptSkills([], fallback), []);
	assert.deepEqual(
		resolvePromptSkills(
			[
				{
					name: "manual-only",
					description: "Only loaded by explicit command",
					filePath: "/skills/manual-only/SKILL.md",
					disableModelInvocation: true,
				},
			],
			fallback,
		),
		[],
	);
});

test("resolvePromptSkills falls back to scraped skills when structured skills are unavailable", () => {
	const fallback = [
		{
			name: "scraped-skill",
			description: "Scraped from the rendered prompt",
			filePath: "/skills/scraped-skill/SKILL.md",
		},
	];

	assert.deepEqual(resolvePromptSkills(undefined, fallback), fallback);
});
