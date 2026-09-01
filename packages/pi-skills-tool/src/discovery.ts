import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	getAgentDir,
	loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import { parseSkillDocument, validateSkill } from "./skill-document.js";

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

interface DirectoryCatalog {
	skills: CatalogSkill[];
	hiddenNames: Set<string>;
}

export function defaultSkillsDir(): string {
	return join(getAgentDir(), "skills");
}

export function defaultSessionSkillsDir(cwd = process.cwd()): string {
	return join(cwd, ".pi", "skills");
}

function skillFileIn(directory: string): string | undefined {
	const path = join(directory, SKILL_FILENAME);
	return existsSync(path) ? path : undefined;
}

export function directoryEntries(directory: string): Dirent[] {
	return readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.filter((entry) => !entry.name.startsWith("."));
}

export function entryKind(
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

export function isWithin(root: string, path: string): boolean {
	const child = relative(root, path);
	return (
		child === "" ||
		(!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
	);
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

export function discoverVisibleSkills(
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
