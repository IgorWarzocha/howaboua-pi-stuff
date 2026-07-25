#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 48 * 1024;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const SKILL_FILENAMES = ["SKILL.md", "SKILL.MD"];

export function defaultSkillsDir() {
	const scriptPath = fileURLToPath(import.meta.url);
	const agentDir = dirname(dirname(dirname(scriptPath)));
	return join(agentDir, "more-skills");
}

function decodeQuotedScalar(value, path, field) {
	if (value.startsWith('"')) {
		try {
			const parsed = JSON.parse(value);
			if (typeof parsed !== "string") throw new Error();
			return parsed;
		} catch {
			throw new Error(`${path}: ${field} must be a valid quoted YAML string`);
		}
	}
	if (value.startsWith("'")) {
		if (!value.endsWith("'") || value.length < 2) {
			throw new Error(`${path}: ${field} must be a valid quoted YAML string`);
		}
		return value.slice(1, -1).replace(/''/g, "'");
	}
	return value;
}

function parseBlockScalar(lines, start, parentIndent, style) {
	const values = [];
	let commonIndent;
	let index = start;
	for (; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line.trim()) {
			values.push("");
			continue;
		}
		const indent = line.match(/^\s*/)[0].length;
		if (indent <= parentIndent) break;
		commonIndent = commonIndent === undefined ? indent : Math.min(commonIndent, indent);
		values.push(line);
	}
	const indent = commonIndent ?? parentIndent + 1;
	const normalized = values.map((line) => line.slice(Math.min(indent, line.length)));
	const value = style === ">"
		? normalized.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ")
		: normalized.join("\n");
	return { value: value.trim(), nextIndex: index };
}

export function parseSkillDocument(content, label) {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0] !== "---") {
		throw new Error(`${label}: missing YAML frontmatter`);
	}
	const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
	if (end < 0) throw new Error(`${label}: unterminated YAML frontmatter`);

	const fields = {};
	for (let index = 1; index < end; index += 1) {
		const line = lines[index];
		const match = /^(\s*)(name|description):\s*(.*)$/.exec(line);
		if (!match) continue;
		const [, whitespace, field, rawValue] = match;
		const block = /^([>|])[-+]?\s*$/.exec(rawValue);
		if (block) {
			const parsed = parseBlockScalar(lines.slice(0, end), index + 1, whitespace.length, block[1]);
			fields[field] = parsed.value;
			index = parsed.nextIndex - 1;
			continue;
		}
		fields[field] = decodeQuotedScalar(rawValue.trim(), label, field);
	}
	return {
		frontmatter: fields,
		body: lines.slice(end + 1).join("\n").trim(),
	};
}

function validateSkill(skill) {
	const errors = [];
	if (!skill.name) errors.push("name is required");
	else {
		if (skill.name === "list") errors.push('name "list" is reserved by the loader');
		if (skill.name.length > MAX_NAME_LENGTH) errors.push(`name exceeds ${MAX_NAME_LENGTH} characters`);
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
			errors.push("name must contain only lowercase letters, numbers, and single hyphens");
		}
	}
	if (!skill.description?.trim()) errors.push("description is required");
	else if (skill.description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
	}
	if (!skill.body) errors.push("Markdown body is required");
	if (errors.length) throw new Error(`${skill.packageName}: ${errors.join("; ")}`);
}

function skillFileIn(directory, packageName) {
	const matches = SKILL_FILENAMES.map((name) => join(directory, name)).filter(existsSync);
	if (matches.length > 1) {
		throw new Error(`${packageName}: keep only one of SKILL.md or SKILL.MD`);
	}
	return matches[0];
}

function directoryEntries(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))
		.filter((entry) => !entry.name.startsWith("."));
}

function isDirectoryEntry(entry, path) {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function loadSkill(directory, packageName, category) {
	const path = skillFileIn(directory, packageName);
	if (!path) return undefined;
	const content = readFileSync(path, "utf8");
	const document = parseSkillDocument(content, packageName);
	const skill = {
		name: document.frontmatter.name || packageName.split("/").at(-1),
		description: document.frontmatter.description,
		packageName,
		category,
		body: document.body,
	};
	validateSkill(skill);
	return skill;
}

export function discoverSkills(root = defaultSkillsDir()) {
	if (!existsSync(root)) return [];
	const skills = [];
	for (const entry of directoryEntries(root)) {
		const directory = join(root, entry.name);
		if (!isDirectoryEntry(entry, directory)) continue;

		const directSkill = loadSkill(directory, entry.name, "other");
		if (directSkill) {
			skills.push(directSkill);
			continue;
		}

		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) {
			throw new Error(`${entry.name}: category names must contain only lowercase letters, numbers, and single hyphens`);
		}
		for (const child of directoryEntries(directory)) {
			const childDirectory = join(directory, child.name);
			if (!isDirectoryEntry(child, childDirectory)) continue;
			const skill = loadSkill(childDirectory, `${entry.name}/${child.name}`, entry.name);
			if (skill) skills.push(skill);
		}
	}

	const names = new Map();
	for (const skill of skills) {
		const existing = names.get(skill.name);
		if (existing) throw new Error(`Duplicate additional skill name "${skill.name}" in packages ${existing} and ${skill.packageName}`);
		names.set(skill.name, skill.packageName);
	}
	return skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function formatSkillList(skills) {
	if (!skills.length) {
		return "No additional skills available.";
	}
	const groups = new Map();
	for (const skill of skills) {
		const group = groups.get(skill.category) ?? [];
		group.push(skill);
		groups.set(skill.category, group);
	}
	const categories = [...groups].sort(([left], [right]) => {
		if (left === "other") return 1;
		if (right === "other") return -1;
		return left.localeCompare(right);
	});
	const lines = [];
	for (const [category, categorySkills] of categories) {
		lines.push(`# ${category.replace(/-/g, " ").toUpperCase()}`);
		for (const skill of categorySkills) {
			lines.push(`- ${skill.name}: ${skill.description.replace(/\s+/g, " ").trim()}`);
		}
	}
	const output = lines.join("\n");
	const bytes = Buffer.byteLength(output);
	if (bytes > MAX_OUTPUT_BYTES) {
		throw new Error(`Additional skill catalog is ${bytes} bytes; shorten descriptions to keep it under ${MAX_OUTPUT_BYTES} bytes`);
	}
	return output;
}

export function run(argument, root = defaultSkillsDir()) {
	if (typeof argument !== "string" || !argument) {
		throw new Error('Expected "list" or an exact skill name.');
	}
	const skills = discoverSkills(root);
	if (argument === "list") return formatSkillList(skills);
	const skill = skills.find((candidate) => candidate.name === argument);
	if (!skill) {
		const available = skills.map(({ name }) => name).join(", ") || "none";
		throw new Error(`Unknown additional skill "${argument}". Available names: ${available}. Call with "list" to inspect descriptions.`);
	}
	const bytes = Buffer.byteLength(skill.body);
	if (bytes > MAX_OUTPUT_BYTES) {
		throw new Error(`Skill "${skill.name}" is ${bytes} bytes; maximum loadable size is ${MAX_OUTPUT_BYTES} bytes`);
	}
	return skill.body;
}

function isMainModule() {
	return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
	try {
		process.stdout.write(run(process.argv[2]));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
