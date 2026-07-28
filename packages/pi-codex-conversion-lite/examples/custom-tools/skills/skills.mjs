#!/usr/bin/env node

import { Buffer } from "node:buffer";
import {
	existsSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 48 * 1024;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const SKILL_FILENAMES = ["SKILL.md", "SKILL.MD"];

export function defaultSkillsDir() {
	const scriptPath = fileURLToPath(import.meta.url);
	const agentDir = dirname(dirname(dirname(scriptPath)));
	return join(agentDir, "lazy-skills");
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
	if (lines[0] !== "---") throw new Error(`${label}: missing YAML frontmatter`);
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
	if (matches.length > 1) throw new Error(`${packageName}: keep only one of SKILL.md or SKILL.MD`);
	return matches[0];
}

function directoryEntries(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))
		.filter((entry) => !entry.name.startsWith("."));
}

function entryKind(entry, path) {
	if (entry.isDirectory()) return "directory";
	if (entry.isFile()) return "file";
	if (!entry.isSymbolicLink()) return undefined;
	try {
		const target = statSync(path);
		if (target.isDirectory()) return "directory";
		if (target.isFile()) return "file";
	} catch {
		return undefined;
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
		directory: resolve(directory),
		path: resolve(path),
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
		if (entryKind(entry, directory) !== "directory") continue;

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
			if (entryKind(child, childDirectory) !== "directory") continue;
			const skill = loadSkill(childDirectory, `${entry.name}/${child.name}`, entry.name);
			if (skill) skills.push(skill);
		}
	}

	const names = new Map();
	for (const skill of skills) {
		const existing = names.get(skill.name);
		if (existing) {
			throw new Error(`Duplicate skill name "${skill.name}" in packages ${existing} and ${skill.packageName}`);
		}
		names.set(skill.name, skill.packageName);
	}
	return skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function parseRequest(input) {
	if (typeof input !== "string") throw new Error("skills expects a string command");
	const parts = input.trim().split(/\s+/).filter(Boolean);
	const [action, ...arguments_] = parts;
	if (action === "list") return { action, categories: [...new Set(arguments_)] };
	if (action === "read" && arguments_.length === 1) {
		return { action, name: arguments_[0] };
	}
	if (action === "read") throw new Error('read expects exactly one skill name: "read <exact-skill-name>"');
	throw new Error('Expected "list", "list <category>...", or "read <exact-skill-name>"');
}

function formatSkillList(skills, requestedCategories = []) {
	const availableCategories = [...new Set(skills.map(({ category }) => category))].sort();
	const unknown = requestedCategories.filter((category) => !availableCategories.includes(category));
	if (unknown.length) {
		throw new Error(`Unknown categor${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}. Available: ${availableCategories.join(", ") || "none"}`);
	}
	const selected = requestedCategories.length
		? skills.filter(({ category }) => requestedCategories.includes(category))
		: skills;
	if (!selected.length) return "No skills available.";

	const groups = new Map();
	for (const skill of selected) {
		const group = groups.get(skill.category) ?? [];
		group.push(skill);
		groups.set(skill.category, group);
	}
	const lines = [];
	for (const [category, categorySkills] of groups) {
		lines.push(`# ${category.replace(/-/g, " ").toUpperCase()}`);
		for (const skill of categorySkills) {
			lines.push(`- ${skill.name}: ${skill.description.replace(/\s+/g, " ").trim()}`);
		}
	}
	return lines.join("\n");
}

function isWithin(root, path) {
	const child = relative(root, path);
	return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

export function packageFiles(skill) {
	const root = realpathSync(skill.directory);
	const paths = [];
	const visitedDirectories = new Set();

	function listAssetEntries(directory) {
		for (const entry of directoryEntries(directory)) {
			const path = join(directory, entry.name);
			if (!entryKind(entry, path)) continue;
			try {
				if (!isWithin(root, realpathSync(path))) continue;
			} catch {
				continue;
			}
			paths.push(resolve(path));
		}
	}

	function visit(directory) {
		const realDirectory = realpathSync(directory);
		if (!isWithin(root, realDirectory) || visitedDirectories.has(realDirectory)) return;
		visitedDirectories.add(realDirectory);
		for (const entry of directoryEntries(directory)) {
			const path = join(directory, entry.name);
			const kind = entryKind(entry, path);
			if (!kind) continue;
			let realPath;
			try {
				realPath = realpathSync(path);
			} catch {
				continue;
			}
			if (!isWithin(root, realPath)) continue;
			if (kind === "directory") {
				if (directory === skill.directory && entry.name === "assets") listAssetEntries(path);
				else visit(path);
			} else paths.push(resolve(path));
		}
	}

	visit(skill.directory);
	return paths.sort((left, right) => {
		if (left === skill.path) return -1;
		if (right === skill.path) return 1;
		return left.localeCompare(right);
	});
}

function formatSkill(skill) {
	const paths = packageFiles(skill);
	return `${skill.body}\n\n---\nSkill paths (${paths.length}):\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

function enforceOutputLimit(output) {
	const bytes = Buffer.byteLength(output);
	if (bytes > MAX_OUTPUT_BYTES) {
		throw new Error(`skills output is ${bytes} bytes; maximum is ${MAX_OUTPUT_BYTES} bytes`);
	}
	return output;
}

export function run(input, root = defaultSkillsDir()) {
	const request = parseRequest(input);
	const skills = discoverSkills(root);
	if (request.action === "list") {
		return enforceOutputLimit(formatSkillList(skills, request.categories));
	}
	const skill = skills.find(({ name }) => name === request.name);
	if (!skill) {
		throw new Error(`Unknown skill "${request.name}". Available: ${skills.map(({ name }) => name).join(", ") || "none"}`);
	}
	return enforceOutputLimit(formatSkill(skill));
}

function isMainModule() {
	return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
	try {
		process.stdout.write(run(readFileSync(0, "utf8")));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
