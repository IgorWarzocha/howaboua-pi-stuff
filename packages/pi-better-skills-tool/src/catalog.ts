import { Buffer } from "node:buffer";
import {
	type CatalogSkill,
	defaultSessionSkillsDir,
	defaultSkillsDir,
	discoverVisibleSkills,
	type LoadedSkill,
} from "./discovery.js";
import { readSkillPackage } from "./skill-package.js";

export type { LoadedSkill } from "./discovery.js";
export {
	defaultSessionSkillsDir,
	defaultSkillsDir,
	discoverSkills,
} from "./discovery.js";

const MAX_OUTPUT_BYTES = 48 * 1024;

type SkillRequest =
	| { action: "list"; categories: string[] }
	| { action: "read"; name: string; references: string[] };

export function parseRequest(input: unknown): SkillRequest {
	if (typeof input !== "string")
		throw new Error("skills expects a string command");
	const parts = input.trim().split(/\s+/).filter(Boolean);
	const [action, ...arguments_] = parts;
	if (!action || action === "list") {
		return { action: "list", categories: [...new Set(arguments_)] };
	}
	if (action === "read" && arguments_.length >= 1) {
		return {
			action,
			name: arguments_[0] ?? "",
			references: [...new Set(arguments_.slice(1))],
		};
	}
	if (action === "read") {
		throw new Error(
			'read expects one skill name and optional reference names: "read <exact-skill-name> [reference...]"',
		);
	}
	throw new Error(
		'Expected "list", "list <category>...", or "read <exact-skill-name> [reference...]"',
	);
}

function formatSkillList(
	skills: CatalogSkill[],
	requestedCategories: string[] = [],
): string {
	const availableCategories = [
		...new Set(skills.flatMap(({ category }) => (category ? [category] : []))),
	].sort();
	const unknown = requestedCategories.filter(
		(category) => !availableCategories.includes(category),
	);
	if (unknown.length) {
		throw new Error(
			"Unknown categor" +
				(unknown.length === 1 ? "y" : "ies") +
				": " +
				unknown.join(", ") +
				". Available: " +
				(availableCategories.join(", ") || "none"),
		);
	}
	const selected = requestedCategories.length
		? skills.filter(({ category }) =>
				requestedCategories.includes(category ?? ""),
			)
		: skills;
	if (!selected.length) return "No skills available.";

	const topLevel = selected.filter(({ category }) => !category);
	const groups = new Map<string, CatalogSkill[]>();
	for (const skill of selected) {
		if (!skill.category) continue;
		const group = groups.get(skill.category) ?? [];
		group.push(skill);
		groups.set(skill.category, group);
	}
	const lines = topLevel.map(
		(skill) =>
			`- ${skill.name}: ${skill.description.replace(/\s+/g, " ").trim()}`,
	);
	if (topLevel.length && groups.size) lines.push("");
	for (const [category, categorySkills] of groups) {
		lines.push(`# ${category.replace(/-/g, " ").toUpperCase()}`);
		for (const skill of categorySkills) {
			lines.push(
				`- ${skill.name}: ${skill.description.replace(/\s+/g, " ").trim()}`,
			);
		}
	}
	return lines.join("\n");
}

function enforceOutputLimit(output: string): string {
	const bytes = Buffer.byteLength(output);
	if (bytes > MAX_OUTPUT_BYTES) {
		throw new Error(
			`skills output is ${bytes} bytes; maximum is ${MAX_OUTPUT_BYTES} bytes`,
		);
	}
	return output;
}

export function runSkills(
	input: unknown,
	globalRoot = defaultSkillsDir(),
	sessionRoot: string | undefined = globalRoot === defaultSkillsDir()
		? defaultSessionSkillsDir()
		: undefined,
	loadedSkills: readonly LoadedSkill[] = [],
): string {
	const request = parseRequest(input);
	const skills = discoverVisibleSkills(globalRoot, sessionRoot, loadedSkills);
	return enforceOutputLimit(
		request.action === "list"
			? formatSkillList(skills, request.categories)
			: readSkillPackage(skills, request.name, request.references),
	);
}
