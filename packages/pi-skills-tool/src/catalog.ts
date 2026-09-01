import { Buffer } from "node:buffer";
import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	getAgentDir,
	loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";

const MAX_OUTPUT_BYTES = 48 * 1024;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const SKILL_FILENAME = "SKILL.md";

type SkillCategory = string | undefined;

export interface LoadedSkill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation?: boolean;
	sourceInfo?: { scope?: string };
}

export interface CatalogSkill {
	name: string;
	description: string;
	packageName: string;
	category: SkillCategory;
	directory: string;
	path: string;
	body: string;
}

interface SkillDocument {
	frontmatter: Partial<Record<"name" | "description", string>>;
	body: string;
}

interface DirectoryCatalog {
	skills: CatalogSkill[];
	hiddenNames: Set<string>;
}

type SkillRequest =
	| { action: "list"; categories: string[] }
	| { action: "read"; name: string; references: string[] };

export function defaultSkillsDir(): string {
	return join(getAgentDir(), "skills");
}

export function defaultSessionSkillsDir(cwd = process.cwd()): string {
	return join(cwd, ".pi", "skills");
}

function decodeQuotedScalar(
	value: string,
	path: string,
	field: string,
): string {
	if (value.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value);
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

function parseBlockScalar(
	lines: string[],
	start: number,
	parentIndent: number,
	style: string,
): { value: string; nextIndex: number } {
	const values: string[] = [];
	let commonIndent: number | undefined;
	let index = start;
	for (; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			values.push("");
			continue;
		}
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		if (indent <= parentIndent) break;
		commonIndent =
			commonIndent === undefined ? indent : Math.min(commonIndent, indent);
		values.push(line);
	}
	const indent = commonIndent ?? parentIndent + 1;
	const normalized = values.map((line) =>
		line.slice(Math.min(indent, line.length)),
	);
	const value =
		style === ">"
			? normalized.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ")
			: normalized.join("\n");
	return { value: value.trim(), nextIndex: index };
}

function parseSkillDocument(content: string, label: string): SkillDocument {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0] !== "---") throw new Error(`${label}: missing YAML frontmatter`);
	const end = lines.findIndex(
		(line, index) => index > 0 && (line === "---" || line === "..."),
	);
	if (end < 0) throw new Error(`${label}: unterminated YAML frontmatter`);

	const fields: SkillDocument["frontmatter"] = {};
	for (let index = 1; index < end; index += 1) {
		const line = lines[index] ?? "";
		const match = /^(\s*)(name|description):\s*(.*)$/.exec(line);
		if (!match) continue;
		const whitespace = match[1] ?? "";
		const field = match[2] as "name" | "description";
		const rawValue = match[3] ?? "";
		const block = /^([>|])[-+]?\s*$/.exec(rawValue);
		if (block) {
			const parsed = parseBlockScalar(
				lines.slice(0, end),
				index + 1,
				whitespace.length,
				block[1] ?? "|",
			);
			fields[field] = parsed.value;
			index = parsed.nextIndex - 1;
			continue;
		}
		fields[field] = decodeQuotedScalar(rawValue.trim(), label, field);
	}
	return {
		frontmatter: fields,
		body: lines
			.slice(end + 1)
			.join("\n")
			.trim(),
	};
}

function validateSkill(skill: CatalogSkill): void {
	const errors: string[] = [];
	if (!skill.name) errors.push("name is required");
	else {
		if (skill.name.length > MAX_NAME_LENGTH)
			errors.push(`name exceeds ${MAX_NAME_LENGTH} characters`);
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
			errors.push(
				"name must contain only lowercase letters, numbers, and single hyphens",
			);
		}
	}
	if (!skill.description?.trim()) errors.push("description is required");
	else if (skill.description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
	}
	if (!skill.body) errors.push("Markdown body is required");
	if (errors.length)
		throw new Error(`${skill.packageName}: ${errors.join("; ")}`);
}

function skillFileIn(directory: string): string | undefined {
	const path = join(directory, SKILL_FILENAME);
	return existsSync(path) ? path : undefined;
}

function directoryEntries(directory: string): Dirent[] {
	return readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.filter((entry) => !entry.name.startsWith("."));
}

function entryKind(
	entry: Dirent,
	path: string,
): "directory" | "file" | undefined {
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
	return undefined;
}

function loadSkill(
	directory: string,
	packageName: string,
	category: SkillCategory,
	hiddenPaths: ReadonlySet<string>,
): CatalogSkill | null | undefined {
	const path = skillFileIn(directory);
	if (!path) return undefined;
	if (hiddenPaths.has(resolve(path))) return null;
	const document = parseSkillDocument(readFileSync(path, "utf8"), packageName);
	const skill: CatalogSkill = {
		name: document.frontmatter.name || packageName.split("/").at(-1) || "",
		description: document.frontmatter.description ?? "",
		packageName,
		category,
		directory: resolve(directory),
		path: resolve(path),
		body: document.body,
	};
	validateSkill(skill);
	return skill;
}

function discoverDirectoryCatalog(root: string): DirectoryCatalog {
	if (!existsSync(root)) return { skills: [], hiddenNames: new Set() };
	const loaded = loadSkillsFromDir({ dir: root, source: "skills-tool" }).skills;
	const hidden = loaded.filter((skill) => skill.disableModelInvocation);
	const hiddenPaths = new Set(hidden.map((skill) => resolve(skill.filePath)));
	const hiddenNames = new Set(hidden.map((skill) => skill.name));
	const skills: CatalogSkill[] = [];
	for (const entry of directoryEntries(root)) {
		const directory = join(root, entry.name);
		if (entryKind(entry, directory) !== "directory") continue;

		const directSkill = loadSkill(
			directory,
			entry.name,
			undefined,
			hiddenPaths,
		);
		if (directSkill !== undefined) {
			if (directSkill) skills.push(directSkill);
			continue;
		}
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) {
			throw new Error(
				`${entry.name}: category names must contain only lowercase letters, numbers, and single hyphens`,
			);
		}
		for (const child of directoryEntries(directory)) {
			const childDirectory = join(directory, child.name);
			if (entryKind(child, childDirectory) !== "directory") continue;
			const skill = loadSkill(
				childDirectory,
				`${entry.name}/${child.name}`,
				entry.name,
				hiddenPaths,
			);
			if (skill) skills.push(skill);
		}
	}

	const names = new Map<string, string>();
	for (const skill of skills) {
		const existing = names.get(skill.name);
		if (existing) {
			throw new Error(
				`Duplicate skill name "${skill.name}" in packages ${existing} and ${skill.packageName}`,
			);
		}
		names.set(skill.name, skill.packageName);
	}
	return { skills: sortSkills(skills), hiddenNames };
}

export function discoverSkills(root = defaultSkillsDir()): CatalogSkill[] {
	return discoverDirectoryCatalog(root).skills;
}

function categoryRank(category: SkillCategory): number {
	if (!category) return 0;
	if (category === "session") return 1;
	return 2;
}

function sortSkills(skills: CatalogSkill[]): CatalogSkill[] {
	return skills.sort(
		(left, right) =>
			categoryRank(left.category) - categoryRank(right.category) ||
			(left.category ?? "").localeCompare(right.category ?? "") ||
			left.name.localeCompare(right.name),
	);
}

function isWithin(root: string, path: string): boolean {
	const child = relative(root, path);
	return (
		child === "" ||
		(!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
	);
}

function loadedSkillCategory(
	skill: LoadedSkill,
	globalRoot: string,
	sessionRoot: string | undefined,
): SkillCategory {
	const directory = resolve(skill.baseDir);
	if (sessionRoot && isWithin(resolve(sessionRoot), directory))
		return "session";
	if (skill.sourceInfo?.scope === "project") return "session";
	if (!isWithin(resolve(globalRoot), directory)) return undefined;
	const [category, nested] = relative(resolve(globalRoot), directory).split(
		sep,
	);
	return category && nested ? category : undefined;
}

function catalogLoadedSkill(
	skill: LoadedSkill,
	globalRoot: string,
	sessionRoot: string | undefined,
): CatalogSkill {
	const document = parseSkillDocument(
		readFileSync(skill.filePath, "utf8"),
		skill.name,
	);
	const catalogSkill: CatalogSkill = {
		name: skill.name,
		description: skill.description,
		packageName: skill.name,
		category: loadedSkillCategory(skill, globalRoot, sessionRoot),
		directory: resolve(skill.baseDir),
		path: resolve(skill.filePath),
		body: document.body,
	};
	validateSkill(catalogSkill);
	return catalogSkill;
}

function discoverVisibleSkills(
	globalRoot = defaultSkillsDir(),
	sessionRoot: string | undefined = globalRoot === defaultSkillsDir()
		? defaultSessionSkillsDir()
		: undefined,
	loadedSkills: readonly LoadedSkill[] = [],
): CatalogSkill[] {
	if (loadedSkills.length > 0) {
		return sortSkills(
			loadedSkills
				.filter((skill) => !skill.disableModelInvocation)
				.map((skill) => catalogLoadedSkill(skill, globalRoot, sessionRoot)),
		);
	}

	const globalCatalog = discoverDirectoryCatalog(globalRoot);
	const byName = new Map(
		globalCatalog.skills.map((skill) => [skill.name, skill]),
	);
	if (sessionRoot) {
		const sessionCatalog = discoverDirectoryCatalog(sessionRoot);
		for (const hiddenName of sessionCatalog.hiddenNames)
			byName.delete(hiddenName);
		for (const skill of sessionCatalog.skills) {
			byName.set(skill.name, { ...skill, category: "session" });
		}
	}
	return sortSkills([...byName.values()]);
}

function withoutMarkdownSuffix(name: string): string {
	return name.replace(/\.md$/i, "");
}

function referenceCandidates(name: string): string[] {
	const packageRelative = name.startsWith("references/")
		? name.slice("references/".length)
		: name.startsWith("./references/")
			? name.slice("./references/".length)
			: name;
	return [
		...new Set([
			name,
			withoutMarkdownSuffix(name),
			packageRelative,
			withoutMarkdownSuffix(packageRelative),
		]),
	];
}

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

export function packageFiles(skill: CatalogSkill): string[] {
	const root = realpathSync(skill.directory);
	const paths: string[] = [];
	const visitedDirectories = new Set<string>();

	function listAssetEntries(directory: string): void {
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

	function visit(directory: string): void {
		const realDirectory = realpathSync(directory);
		if (!isWithin(root, realDirectory) || visitedDirectories.has(realDirectory))
			return;
		visitedDirectories.add(realDirectory);
		for (const entry of directoryEntries(directory)) {
			const path = join(directory, entry.name);
			const kind = entryKind(entry, path);
			if (!kind) continue;
			let realPath: string;
			try {
				realPath = realpathSync(path);
			} catch {
				continue;
			}
			if (!isWithin(root, realPath)) continue;
			if (kind === "directory") {
				if (directory === skill.directory && entry.name === "assets")
					listAssetEntries(path);
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

function formatSkillPaths(skill: CatalogSkill): string {
	const paths = packageFiles(skill);
	return `---\nSkill paths (${paths.length}):\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

function formatSkill(skill: CatalogSkill): string {
	return `${skill.body}\n\n${formatSkillPaths(skill)}`;
}

function referenceFiles(skill: CatalogSkill): string[] {
	const root = resolve(skill.directory, "references");
	return packageFiles(skill).filter(
		(path) =>
			isWithin(root, path) &&
			path.toLowerCase().endsWith(".md") &&
			statSync(path).isFile(),
	);
}

function readReferences(skill: CatalogSkill, references: string[]): string {
	const root = resolve(skill.directory, "references");
	const available = new Map(
		referenceFiles(skill).map((path) => [
			relative(root, path).replaceAll(sep, "/").replace(/\.md$/i, ""),
			path,
		]),
	);
	const selected: Array<{ reference: string; content: string }> = [];
	const seen = new Set<string>();
	for (const requestedReference of references) {
		const reference = referenceCandidates(requestedReference).find(
			(candidate) => available.has(candidate),
		);
		const path = reference ? available.get(reference) : undefined;
		if (!reference || !path) {
			const choices = [...available.keys()].join(", ") || "none";
			throw new Error(
				`Unknown reference "${requestedReference}" for skill "${skill.name}". Available: ${choices}`,
			);
		}
		if (seen.has(reference)) continue;
		seen.add(reference);
		selected.push({ reference, content: readFileSync(path, "utf8").trim() });
	}
	const content =
		selected.length === 1
			? (selected[0]?.content ?? "")
			: selected
					.map(
						({ reference, content: body }) => `--- ${reference} ---\n${body}`,
					)
					.join("\n\n");
	return `${content}\n\n${formatSkillPaths(skill)}`;
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
	if (request.action === "list") {
		return enforceOutputLimit(formatSkillList(skills, request.categories));
	}
	const skill =
		skills.find(({ name }) => name === request.name) ??
		skills.find(({ name }) => name === withoutMarkdownSuffix(request.name));
	if (!skill) {
		throw new Error(
			`Unknown skill "${request.name}". Available: ${skills.map(({ name }) => name).join(", ") || "none"}`,
		);
	}
	return enforceOutputLimit(
		request.references.length
			? readReferences(skill, request.references)
			: formatSkill(skill),
	);
}
