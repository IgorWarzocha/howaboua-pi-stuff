import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSkillsTool, prepareSkillsCodeModeInput } from "../src/tool.js";

test("maps Code Mode strings into the normal Pi parameter", () => {
	assert.deepEqual(prepareSkillsCodeModeInput("read code-review"), {
		command: "read code-review",
	});
	assert.throws(() => prepareSkillsCodeModeInput({}), /string command/);
});

test("resolves session skills from the execution cwd", async (t) => {
	const globalRoot = mkdtempSync(join(tmpdir(), "skills-global-"));
	const cwd = mkdtempSync(join(tmpdir(), "skills-cwd-"));
	t.after(() => {
		rmSync(globalRoot, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	});
	const skillDirectory = join(cwd, ".pi", "skills", "handoff");
	mkdirSync(skillDirectory, { recursive: true });
	writeFileSync(
		join(skillDirectory, "SKILL.md"),
		"---\nname: handoff\ndescription: Session handoff.\n---\nSession body\n",
	);

	const tool = createSkillsTool({ globalRoot });
	const result = await tool.execute(
		"call",
		{ command: "read handoff" },
		new AbortController().signal,
		undefined,
		{ cwd } as never,
	);
	assert.equal(result.content[0]?.type, "text");
	assert.match(
		result.content[0]?.type === "text" ? result.content[0].text : "",
		/^Session body/,
	);
});
