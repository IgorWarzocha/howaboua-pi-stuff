import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	type CatalogSkill,
	directoryEntries,
	entryKind,
	isWithin,
} from "./discovery.js";

function withoutMarkdownSuffix(name: string): string {
	return name.replace(/\.md$/i, "");
}

function normalizedPath(name: string): string {
	return name.replaceAll("\\", "/");
}

function stripPathPrefix(name: string, prefix: string): string {
	return name.toLowerCase().startsWith(prefix.toLowerCase())
		? name.slice(prefix.length)
		: name;
}

function referenceCandidates(name: string, skill: CatalogSkill): string[] {
	const normalized = normalizedPath(name);
	const packageRelative = stripPathPrefix(
		stripPathPrefix(normalized, "./references/"),
		"references/",
	);
	const skillRelative = stripPathPrefix(
		packageRelative,
		`${skill.name}/references/`,
	);
	return [
		...new Set([
			name,
			withoutMarkdownSuffix(name),
			normalized,
			withoutMarkdownSuffix(normalized),
			packageRelative,
			withoutMarkdownSuffix(packageRelative),
			skillRelative,
			withoutMarkdownSuffix(skillRelative),
		]),
	];
}

function findSkillByName(
	skills: CatalogSkill[],
	name: string,
): CatalogSkill | undefined {
	return (
		skills.find((skill) => skill.name === name) ??
		skills.find((skill) => skill.name === withoutMarkdownSuffix(name))
	);
}

function isOwnSkillDocument(name: string, skill: CatalogSkill): boolean {
	const normalized = normalizedPath(name).toLowerCase();
	return (
		normalized === "skill.md" ||
		normalized === `${skill.name}/skill.md` ||
		(isAbsolute(name) && resolve(name) === resolve(skill.path))
	);
}

interface SkillSelection {
	kind: "skill";
	skill: CatalogSkill;
}

interface ReferenceSelection {
	kind: "reference";
	skill: CatalogSkill;
	reference: string;
	path: string;
}

type ReadSelection = SkillSelection | ReferenceSelection;
type ReferenceCatalog = Map<CatalogSkill, Map<string, string>>;

function packageFiles(skill: CatalogSkill): string[] {
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
				if (entry.name === "node_modules") continue;
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

function referencesForSkill(
	skill: CatalogSkill,
	catalog: ReferenceCatalog,
): Map<string, string> {
	const existing = catalog.get(skill);
	if (existing) return existing;
	const root = resolve(skill.directory, "references");
	const available = new Map(
		referenceFiles(skill).map((path) => [
			relative(root, path).replaceAll(sep, "/").replace(/\.md$/i, ""),
			path,
		]),
	);
	catalog.set(skill, available);
	return available;
}

function findReference(
	skill: CatalogSkill,
	name: string,
	catalog: ReferenceCatalog,
): ReferenceSelection | undefined {
	const available = referencesForSkill(skill, catalog);
	const absoluteReference = isAbsolute(name)
		? [...available].find(([, path]) => resolve(path) === resolve(name))?.[0]
		: undefined;
	const reference =
		absoluteReference ??
		referenceCandidates(name, skill).find((candidate) =>
			available.has(candidate),
		);
	const path = reference ? available.get(reference) : undefined;
	return reference && path
		? { kind: "reference", skill, reference, path }
		: undefined;
}

function unknownReferenceForSkill(name: string, skill: CatalogSkill): never {
	throw new Error(
		`Unknown reference "${name}" for skill "${skill.name}". Use "read ${skill.name}" to inspect its reference paths`,
	);
}

function resolveExplicitSelection(
	skills: CatalogSkill[],
	name: string,
	catalog: ReferenceCatalog,
): ReadSelection | undefined {
	const normalized = normalizedPath(name);
	for (const skill of skills) {
		if (normalized.toLowerCase() === `${skill.name}/skill.md`) {
			return { kind: "skill", skill };
		}
		const prefix = `${skill.name}/references/`;
		if (normalized.toLowerCase().startsWith(prefix)) {
			const requestedReference = normalized.slice(prefix.length);
			return (
				findReference(skill, requestedReference, catalog) ??
				unknownReferenceForSkill(requestedReference, skill)
			);
		}
	}
	if (!isAbsolute(name)) return undefined;
	const requestedPath = resolve(name);
	for (const skill of skills) {
		if (requestedPath === resolve(skill.path)) return { kind: "skill", skill };
		const reference = findReference(skill, requestedPath, catalog);
		if (reference) return reference;
	}
	return undefined;
}

function resolvePrimarySelection(
	skills: CatalogSkill[],
	name: string,
	catalog: ReferenceCatalog,
): ReadSelection {
	const direct = findSkillByName(skills, name);
	if (direct) return { kind: "skill", skill: direct };
	const explicit = resolveExplicitSelection(skills, name, catalog);
	if (explicit) return explicit;
	throw new Error(
		`Unknown skill "${name}". Available: ${skills.map((skill) => skill.name).join(", ") || "none"}`,
	);
}

function resolveAdditionalSelection(
	skills: CatalogSkill[],
	name: string,
	catalog: ReferenceCatalog,
): ReadSelection {
	const exactSkill = skills.find((skill) => skill.name === name);
	if (exactSkill) return { kind: "skill", skill: exactSkill };
	const explicit = resolveExplicitSelection(skills, name, catalog);
	if (explicit) return explicit;
	const references = skills.flatMap((skill) => {
		const reference = findReference(skill, name, catalog);
		return reference ? [reference] : [];
	});
	if (references.length === 1) return references[0] as ReferenceSelection;
	if (references.length > 1) {
		throw new Error(
			`Ambiguous reference "${name}". Use one of: ${references
				.map(
					(reference) =>
						`${reference.skill.name}/references/${reference.reference}`,
				)
				.join(", ")}`,
		);
	}
	throw new Error(
		`Unknown skill or reference "${name}". Use "list" for skill names or "read <skill>" to inspect reference paths`,
	);
}

function deduplicateSelections(selections: ReadSelection[]): ReadSelection[] {
	const seen = new Set<string>();
	return selections.filter((selection) => {
		const path = resolve(
			selection.kind === "skill" ? selection.skill.path : selection.path,
		);
		if (seen.has(path)) return false;
		seen.add(path);
		return true;
	});
}

function formatReferences(selected: ReferenceSelection[]): string {
	const oneSkill = new Set(selected.map(({ skill }) => skill.name)).size === 1;
	const withContent = selected.map((selection) => ({
		...selection,
		content: readFileSync(selection.path, "utf8").trim(),
	}));
	const content =
		withContent.length === 1
			? (withContent[0]?.content ?? "")
			: withContent
					.map(({ skill, reference, content: body }) => {
						const label = oneSkill
							? reference
							: `${skill.name}/references/${reference}`;
						return `--- ${label} ---\n${body}`;
					})
					.join("\n\n");
	return `${content}\n\n---\nSources:\n${withContent.map(({ path }) => `- ${path}`).join("\n")}`;
}

function formatMixedSelections(selections: ReadSelection[]): string {
	const content = selections
		.map((selection) => {
			if (selection.kind === "skill") {
				return `--- ${selection.skill.name} ---\n${formatSkill(selection.skill)}`;
			}
			return `--- ${selection.skill.name}/references/${selection.reference} ---\n${readFileSync(selection.path, "utf8").trim()}`;
		})
		.join("\n\n");
	const sources = selections
		.filter(
			(selection): selection is ReferenceSelection =>
				selection.kind === "reference",
		)
		.map(({ path }) => `- ${path}`);
	return sources.length
		? `${content}\n\n---\nSources:\n${sources.join("\n")}`
		: content;
}

export function readSkillPackage(
	skills: CatalogSkill[],
	name: string,
	selectors: string[],
): string {
	const catalog: ReferenceCatalog = new Map();
	const primary = resolvePrimarySelection(skills, name, catalog);
	const additional = selectors
		.filter((reference) => !isOwnSkillDocument(reference, primary.skill))
		.map((reference) => resolveAdditionalSelection(skills, reference, catalog));
	const selections = deduplicateSelections(
		primary.kind === "skill" &&
			additional.length > 0 &&
			additional.every((selection) => selection.kind === "reference")
			? additional
			: [primary, ...additional],
	);
	if (selections.length === 1) {
		const selection = selections[0] as ReadSelection;
		return selection.kind === "skill"
			? formatSkill(selection.skill)
			: formatReferences([selection]);
	}
	return selections.every(
		(selection): selection is ReferenceSelection =>
			selection.kind === "reference",
	)
		? formatReferences(selections)
		: formatMixedSelections(selections);
}
