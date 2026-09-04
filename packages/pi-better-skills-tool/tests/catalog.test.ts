import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverSkills, parseRequest, runSkills } from "../src/catalog.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "skills-"));
	return {
		root,
		add(directory: string, content: string, filename = "SKILL.md") {
			const path = join(root, directory);
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, filename), content);
		},
		file(path: string, content = "content") {
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
	f.add(
		"design/visual",
		"---\nname: visual\ndescription: Visual work.\n---\nVisual body\n",
	);
	f.add(
		"engineering/qa",
		"---\nname: qa\ndescription: QA work.\n---\nQA body\n",
	);

	const all = runSkills("list", f.root);
	assert.match(all, /# DESIGN/);
	assert.match(all, /# ENGINEERING/);

	const selected = runSkills("list engineering", f.root);
	assert.doesNotMatch(selected, /# DESIGN/);
	assert.match(selected, /^# ENGINEERING\n- qa: QA work\.$/);
});

test("reads instructions and appends absolute package file paths", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add(
		"engineering/tooling",
		"---\nname: tooling\ndescription: Tooling.\n---\n# Tooling\n",
	);
	f.file("engineering/tooling/references/api.md", "API reference\n");
	f.file("engineering/tooling/references/runtime.md", "Runtime reference\n");
	f.file("engineering/tooling/scripts/check.mjs");
	f.file("engineering/tooling/scripts/node_modules/dependency/index.js");
	f.file("engineering/tooling/.private", "hidden");

	const output = runSkills("read tooling", f.root);
	assert.match(output, /^# Tooling\n\n---\nSkill paths \(4\):/);
	assert.match(
		output,
		new RegExp(
			resolve(f.root, "engineering/tooling/SKILL.md").replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&",
			),
		),
	);
	assert.match(output, /references\/api\.md/);
	assert.match(output, /scripts\/check\.mjs/);
	assert.doesNotMatch(output, /\.private/);
	assert.doesNotMatch(output, /node_modules/);
	const reference = runSkills("read tooling api", f.root);
	assert.match(reference, /^API reference\n\n---\nSkill paths \(4\):/);
	assert.match(
		reference,
		new RegExp(
			resolve(f.root, "engineering/tooling/references/api.md").replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&",
			),
		),
	);
	assert.equal(runSkills("read tooling/references/api.md", f.root), reference);
	assert.match(
		runSkills("read tooling runtime api", f.root),
		/^--- runtime ---\nRuntime reference\n\n--- api ---\nAPI reference\n\n---\nSkill paths \(4\):/,
	);
});

test("rejects malformed commands, unknown categories, and names", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add(
		"design/visual",
		"---\nname: visual\ndescription: Visual work.\n---\nBody\n",
	);
	f.add(
		"engineering/review",
		"---\nname: review\ndescription: Review work.\n---\nReview body\n",
	);

	assert.throws(() => parseRequest("search visual"), /Expected/);
	assert.throws(() => parseRequest("read"), /one skill name/);
	assert.throws(() => runSkills("read missing", f.root), /Unknown skill/);
	assert.throws(
		() => runSkills("read visual review", f.root),
		/Read it separately with "read review"/,
	);
});

test("keeps names unique across category packages", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add("design/one", "---\nname: same\ndescription: One.\n---\nOne\n");
	f.add("engineering/two", "---\nname: same\ndescription: Two.\n---\nTwo\n");
	assert.throws(() => discoverSkills(f.root), /Duplicate skill name/);
});

test("shows root skills before categories without inventing a category", (t) => {
	const f = fixture();
	t.after(() => f.cleanup());
	f.add(
		"agents-md",
		"---\nname: agents-md\ndescription: Guidance work.\n---\nBody\n",
	);
	f.add(
		"agent/herdr",
		"---\nname: herdr\ndescription: Panel work.\n---\nBody\n",
	);

	const output = runSkills("list", f.root);
	assert.match(output, /^- agents-md: Guidance work\.\n\n# AGENT/);
	assert.doesNotMatch(output, /# OTHER|# TOP LEVEL/);
	assert.match(
		runSkills("list agent", f.root),
		/^# AGENT\n- herdr: Panel work\.$/,
	);
});

test("puts cwd skills in session and lets them override globals", (t) => {
	const global = fixture();
	const session = fixture();
	t.after(() => global.cleanup());
	t.after(() => session.cleanup());
	global.add(
		"agents-md",
		"---\nname: agents-md\ndescription: Global guidance.\n---\nGlobal body\n",
	);
	global.add(
		"agent/herdr",
		"---\nname: herdr\ndescription: Panel work.\n---\nPanel body\n",
	);
	session.add(
		"agents-md",
		"---\nname: agents-md\ndescription: Session guidance.\n---\nSession body\n",
	);
	session.add(
		"handoff",
		"---\nname: handoff\ndescription: Session handoff.\n---\nHandoff body\n",
	);

	const output = runSkills("list", global.root, session.root);
	assert.match(
		output,
		/^# SESSION\n- agents-md: Session guidance\.\n- handoff: Session handoff\.\n# AGENT/,
	);
	assert.doesNotMatch(output, /Global guidance/);
	assert.match(
		runSkills("read agents-md", global.root, session.root),
		/^Session body/,
	);
	assert.match(
		runSkills("list session", global.root, session.root),
		/^# SESSION/,
	);
});

test("adds Pi-loaded package skills to the filesystem catalog", (t) => {
	const global = fixture();
	const packaged = fixture();
	t.after(() => global.cleanup());
	t.after(() => packaged.cleanup());
	packaged.add(
		"packaged",
		"---\nname: packaged\ndescription: Package skill.\n---\nPackage body\n",
	);
	const filePath = resolve(packaged.root, "packaged/SKILL.md");
	const output = runSkills("read packaged", global.root, undefined, [
		{
			name: "packaged",
			description: "Package skill.",
			filePath,
			baseDir: resolve(packaged.root, "packaged"),
			sourceInfo: { scope: "user" },
		},
	]);
	assert.match(output, /^Package body/);
	assert.match(
		output,
		new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);

	global.add(
		"packaged",
		"---\nname: packaged\ndescription: Global collision.\n---\nGlobal body\n",
	);
	assert.match(
		runSkills("read packaged", global.root, undefined, [
			{
				name: "packaged",
				description: "Project winner.",
				filePath,
				baseDir: resolve(packaged.root, "packaged"),
				sourceInfo: { scope: "project" },
			},
		]),
		/^Package body/,
	);
});

test("keeps user-only skills out of the model catalog", (t) => {
	const global = fixture();
	const packaged = fixture();
	t.after(() => global.cleanup());
	t.after(() => packaged.cleanup());
	global.add(
		"hidden-global",
		"---\nname: hidden-global\ndescription: Hidden.\ndisable-model-invocation: true\n---\nHidden body\n",
	);
	packaged.add(
		"hidden-package",
		"---\nname: hidden-package\ndescription: Hidden.\n---\nHidden body\n",
	);
	assert.doesNotMatch(runSkills("list", global.root), /hidden-global/);
	assert.doesNotMatch(
		runSkills("list", global.root, undefined, [
			{
				name: "hidden-package",
				description: "Hidden.",
				filePath: resolve(packaged.root, "hidden-package/SKILL.md"),
				baseDir: resolve(packaged.root, "hidden-package"),
				disableModelInvocation: true,
			},
		]),
		/hidden-package/,
	);
});
