import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSkillsTool } from "../src/tool.js";

test("resolves cwd skills and returns lossless bounded UTF-8 continuations", async (t) => {
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
	const read = async (command: string) => {
		const result = await tool.execute(
			"call",
			{ command },
			new AbortController().signal,
			undefined,
			{ cwd } as never,
		);
		const content = result.content[0];
		assert.equal(content?.type, "text");
		return content?.type === "text" ? content.text : "";
	};
	const small = await read("read handoff");
	assert.match(small, /^Session body/);
	const bulkDirectory = join(cwd, ".pi", "skills", "bulk");
	mkdirSync(bulkDirectory, { recursive: true });
	const body = "a🌱é界".repeat(12000);
	writeFileSync(
		join(bulkDirectory, "SKILL.md"),
		`---\nname: bulk\ndescription: Bulk.\n---\n${body}\n`,
	);
	const expected = `--- handoff ---\n${small}\n\n--- bulk ---\n${body}\n\n---\nSkill paths (1):\n- ${join(bulkDirectory, "SKILL.md")}\n\n${await read("list session")}`;
	const command = "read handoff bulk; list session";
	const chunks: string[] = [];
	let next = command;
	let offset = 0;
	while (true) {
		const output = await read(next);
		assert.ok(Buffer.byteLength(output) <= 49152);
		assert.doesNotMatch(output, /\uFFFD/);
		const marker = output.match(
			/\n\n---\nIncomplete: bytes (\d+)-(\d+) of (\d+)\. Continue with command:\n(.+)$/,
		);
		if (!marker) {
			chunks.push(output);
			break;
		}
		const chunk = output.slice(0, marker.index);
		chunks.push(chunk);
		assert.equal(Number(marker[1]), offset);
		offset += Buffer.byteLength(chunk);
		assert.equal(Number(marker[2]), offset);
		assert.equal(Number(marker[3]), Buffer.byteLength(expected));
		next = marker[4] ?? "";
		assert.equal(next, `${command} --offset ${offset}`);
	}
	assert.ok(chunks.length > 1);
	assert.equal(chunks.join(""), expected);
	assert.equal(await read(`${command} --offset 0`), await read(command));
	const splitOffset =
		Buffer.byteLength(expected.slice(0, expected.indexOf("🌱"))) + 1;
	await assert.rejects(
		read(`${command} --offset ${splitOffset}`),
		/splits a UTF-8 character/,
	);
	await assert.rejects(
		read(`${command} --offset ${Buffer.byteLength(expected)}`),
		/outside output/,
	);
	await assert.rejects(
		read(`${command} --offset ${Buffer.byteLength(expected) + 1}`),
		/outside output/,
	);
	const references = join(skillDirectory, "references");
	mkdirSync(references);
	const referencePath = join(references, "edge.md");
	const sources = `\n\n---\nSources:\n- ${referencePath}`;
	writeFileSync(referencePath, "x".repeat(49152 - Buffer.byteLength(sources)));
	assert.equal(Buffer.byteLength(await read("read handoff edge")), 49152);
	assert.doesNotMatch(await read("read handoff edge"), /Incomplete/);
	writeFileSync(referencePath, "x".repeat(49153 - Buffer.byteLength(sources)));
	assert.match(await read("read handoff edge"), /Incomplete/);
});
