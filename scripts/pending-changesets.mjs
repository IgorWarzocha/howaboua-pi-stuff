import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bumpOrder = ["none", "patch", "minor", "major"];

export function readPendingChangesets(root) {
	const dir = join(root, ".changesets-pending");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.sort()
		.filter((file) => file.endsWith(".md") && file !== "README.md")
		.map((file) => {
			const path = join(dir, file);
			const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
			const match = text.match(
				/^---\n["']?([^'":\n]+)["']?:\s*(patch|minor|major)\n---\n([\s\S]*)$/,
			);
			if (!match || !match[3].trim()) {
				throw new Error(
					`${path}: expected one package, a patch/minor/major bump and a summary.`,
				);
			}
			return {
				path,
				name: match[1].trim(),
				type: match[2],
				summary: match[3].trim(),
			};
		});
}

export function changesetText(releases, summary) {
	return `---\n${releases.map(({ name, type }) => `${JSON.stringify(name)}: ${type}`).join("\n")}\n---\n\n${summary}\n`;
}

function releasePlan(root) {
	const temp = mkdtempSync(join(tmpdir(), "pi-release-plan-"));
	try {
		const output = join(temp, "plan.json");
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(import.meta.resolve("@changesets/cli/bin.js")),
				"status",
				"--output",
				output,
			],
			{ cwd: root, encoding: "utf8" },
		);
		if (result.status !== 0) {
			throw new Error(
				result.stderr || result.stdout || "Could not plan package releases.",
			);
		}
		return JSON.parse(readFileSync(output, "utf8"));
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

export function promotePendingChangesets(root) {
	let pending = readPendingChangesets(root);
	const activeDir = join(root, ".changeset");
	if (
		!existsSync(activeDir) ||
		!readdirSync(activeDir).some(
			(file) => file.endsWith(".md") && file !== "README.md",
		)
	)
		return;
	while (pending.length > 0) {
		const plan = releasePlan(root);
		const releasing = new Map(
			plan.releases
				.filter(({ type }) => type !== "none")
				.map(({ name, type }) => [name, type]),
		);
		const selected = pending.filter(({ name }) => releasing.has(name));
		if (selected.length === 0) return;
		const names = new Set(selected.map(({ name }) => name));
		for (const name of names) {
			const active = plan.changesets.filter(({ releases }) =>
				releases.some((entry) => entry.name === name),
			);
			const notes = selected.filter((entry) => entry.name === name);
			const types = [releasing.get(name), ...notes.map(({ type }) => type)];
			const type =
				bumpOrder[Math.max(...types.map((value) => bumpOrder.indexOf(value)))];
			const summaries = [
				...notes,
				...active.map((entry) => ({
					summary: entry.summary,
					type: entry.releases.find((release) => release.name === name).type,
				})),
			].sort((a, b) => bumpOrder.indexOf(b.type) - bumpOrder.indexOf(a.type));
			const summary = [
				...new Set(summaries.map((entry) => entry.summary)),
			].join("\n\n");
			const file = `pending-${randomBytes(8).toString("hex")}.md`;
			writeFileSync(
				join(activeDir, file),
				changesetText([{ name, type }], summary),
			);
		}
		// Write merged entries first. Shared raw changesets keep their other packages.
		for (const changeset of plan.changesets) {
			const releases = changeset.releases.filter(
				({ name }) => !names.has(name),
			);
			if (releases.length === changeset.releases.length) continue;
			const path = join(activeDir, `${changeset.id}.md`);
			if (releases.length > 0)
				writeFileSync(path, changesetText(releases, changeset.summary));
			else rmSync(path);
		}
		for (const note of selected) rmSync(note.path);
		console.log(`Included pending notes for ${[...names].join(", ")}.`);
		pending = pending.filter((note) => !names.has(note.name));
		// A deferred higher bump can bring another dependent package into the release.
	}
}
