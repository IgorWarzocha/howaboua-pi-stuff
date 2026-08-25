import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverSkills, packageFiles, parseRequest, run } from "./skills.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "skills-"));
	return {
		root,
		add(directory, content, filename = "SKILL.md") {
			const path = join(root, directory);
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, filename), content);
		},
		file(path, content = "content") {
			const target = join(root, path);
			mkdirSync(join(target, ".."), { recursive: true });
			writeFileSync(target, content);
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

test("lists all categories or an exact category selection", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("design/visual", "---\nname: visual\ndescription: Visual work.\n---\nVisual body\n");
	f.add("engineering/qa", "---\nname: qa\ndescription: QA work.\n---\nQA body\n");

	const all = run("list", f.root);
	assert.match(all, /# DESIGN/);
	assert.match(all, /# ENGINEERING/);

	const selected = run("list engineering", f.root);
	assert.doesNotMatch(selected, /# DESIGN/);
	assert.match(selected, /^# ENGINEERING\n- qa: QA work\.$/);

	const both = run("list engineering design", f.root);
	assert.match(both, /# DESIGN/);
	assert.match(both, /# ENGINEERING/);
});

test("reads instructions and appends absolute package file paths", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("engineering/tooling", "---\nname: tooling\ndescription: Tooling.\n---\n# Tooling\n");
	f.file("engineering/tooling/references/api.md", "API reference\n");
	f.file("engineering/tooling/references/runtime.md", "Runtime reference\n");
	f.file("engineering/tooling/scripts/check.mjs");
	f.file("engineering/tooling/.private", "hidden");

	const output = run("read tooling", f.root);
	assert.match(output, /^# Tooling\n\n---\nSkill paths \(4\):/);
	assert.match(output, new RegExp(resolve(f.root, "engineering/tooling/SKILL.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(output, /references\/api\.md/);
	assert.match(output, /scripts\/check\.mjs/);
	assert.doesNotMatch(output, /\.private/);
	const reference = run("read tooling api", f.root);
	assert.match(reference, /^API reference\n\n---\nSkill paths \(4\):/);
	assert.match(reference, new RegExp(resolve(f.root, "engineering/tooling/references/api.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(
		run("read tooling runtime api", f.root),
		/^--- runtime ---\nRuntime reference\n\n--- api ---\nAPI reference\n\n---\nSkill paths \(4\):/,
	);
});

test("rejects malformed commands, unknown categories, and names", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("design/visual", "---\nname: visual\ndescription: Visual work.\n---\nBody\n");

	assert.deepEqual(parseRequest(""), { action: "list", categories: [] });
	assert.throws(() => parseRequest("search visual"), /Expected/);
	assert.throws(() => parseRequest("read"), /one skill name/);
	assert.throws(() => run("list missing", f.root), /Unknown category/);
	assert.throws(() => run("read missing", f.root), /Unknown skill/);
	assert.throws(() => run("read visual SKILL", f.root), /Unknown reference/);
});

test("keeps names unique across category packages", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("design/one", "---\nname: same\ndescription: One.\n---\nOne\n");
	f.add("engineering/two", "---\nname: same\ndescription: Two.\n---\nTwo\n");
	assert.throws(() => discoverSkills(f.root), /Duplicate skill name/);
});

test("packageFiles puts SKILL.md first", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("writing/copy", "---\nname: copy\ndescription: Copy.\n---\nBody\n");
	f.file("writing/copy/assets/a.txt");
	f.file("writing/copy/assets/audio/deep.ogg");
	const [skill] = discoverSkills(f.root);
	const paths = packageFiles(skill);
	assert.equal(paths[0], resolve(f.root, "writing/copy/SKILL.md"));
	assert.ok(paths.includes(resolve(f.root, "writing/copy/assets/a.txt")));
	assert.ok(paths.includes(resolve(f.root, "writing/copy/assets/audio")));
	assert.ok(!paths.includes(resolve(f.root, "writing/copy/assets/audio/deep.ogg")));
});

test("shows root skills before categories without inventing a category", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("agents-md", "---\nname: agents-md\ndescription: Guidance work.\n---\nBody\n");
	f.add("agent/herdr", "---\nname: herdr\ndescription: Panel work.\n---\nBody\n");

	const output = run("", f.root);
	assert.match(output, /^- agents-md: Guidance work\.\n\n# AGENT/);
	assert.doesNotMatch(output, /# OTHER|# TOP LEVEL/);
	assert.match(run("list agent", f.root), /^# AGENT\n- herdr: Panel work\.$/);
});

test("puts cwd skills in session and lets them override globals", (t) => {
	const global = fixture();
	const session = fixture();
	t.after(() => global.cleanup());
	t.after(() => session.cleanup());
	global.add("agents-md", "---\nname: agents-md\ndescription: Global guidance.\n---\nGlobal body\n");
	global.add("agent/herdr", "---\nname: herdr\ndescription: Panel work.\n---\nPanel body\n");
	session.add("agents-md", "---\nname: agents-md\ndescription: Session guidance.\n---\nSession body\n");
	session.add("handoff", "---\nname: handoff\ndescription: Session handoff.\n---\nHandoff body\n");

	const output = run("list", global.root, session.root);
	assert.match(output, /^# SESSION\n- agents-md: Session guidance\.\n- handoff: Session handoff\.\n# AGENT/);
	assert.doesNotMatch(output, /Global guidance/);
	assert.match(run("read agents-md", global.root, session.root), /^Session body/);
	assert.match(run("list session", global.root, session.root), /^# SESSION/);
});
