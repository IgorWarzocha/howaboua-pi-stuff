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

function resolveSkillRead(
	skills: CatalogSkill[],
	name: string,
	references: string[],
): { skill: CatalogSkill; references: string[] } | undefined {
	const direct = findSkillByName(skills, name);
	if (direct) return { skill: direct, references };
	const normalized = normalizedPath(name);
	for (const skill of skills) {
		if (normalized.toLowerCase() === `${skill.name}/skill.md`) {
			return { skill, references };
		}
		const prefix = `${skill.name}/references/`;
		if (normalized.toLowerCase().startsWith(prefix)) {
			const reference = normalized.slice(prefix.length);
			if (reference) {
				return {
					skill,
					references: [...new Set([reference, ...references])],
				};
			}
		}
	}
	if (!isAbsolute(name)) return undefined;
	const requestedPath = resolve(name);
	for (const skill of skills) {
		if (requestedPath === resolve(skill.path)) {
			return { skill, references };
		}
		const reference = referenceFiles(skill).find(
			(path) => resolve(path) === requestedPath,
		);
		if (reference) {
			return {
				skill,
				references: [...new Set([reference, ...references])],
			};
		}
	}
	return undefined;
}

function isOwnSkillDocument(reference: string, skill: CatalogSkill): boolean {
	const normalized = normalizedPath(reference).toLowerCase();
	return (
		normalized === "skill.md" ||
		normalized === `${skill.name}/skill.md` ||
		(isAbsolute(reference) && resolve(reference) === resolve(skill.path))
	);
}

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

function readReferences(
	skill: CatalogSkill,
	references: string[],
	skills: CatalogSkill[],
): string {
	const root = resolve(skill.directory, "references");
	const available = new Map(
		referenceFiles(skill).map((path) => [
			relative(root, path).replaceAll(sep, "/").replace(/\.md$/i, ""),
			path,
		]),
	);
	const selected: Array<{ reference: string; path: string; content: string }> =
		[];
	const seen = new Set<string>();
	for (const requestedReference of references) {
		const absoluteReference = isAbsolute(requestedReference)
			? [...available].find(
					([, path]) => resolve(path) === resolve(requestedReference),
				)?.[0]
			: undefined;
		const reference =
			absoluteReference ??
			referenceCandidates(requestedReference, skill).find((candidate) =>
				available.has(candidate),
			);
		const path = reference ? available.get(reference) : undefined;
		if (!reference || !path) {
			const separate = resolveSkillRead(skills, requestedReference, []);
			if (separate && separate.skill !== skill) {
				const command = [
					"read",
					separate.skill.name,
					...separate.references,
				].join(" ");
				throw new Error(
					`"${requestedReference}" is a separate skill, not a reference of "${skill.name}". Read it separately with "${command}"`,
				);
			}
			const choices = [...available.keys()].join(", ") || "none";
			throw new Error(
				`Unknown reference "${requestedReference}" for skill "${skill.name}". Available: ${choices}`,
			);
		}
		if (seen.has(reference)) continue;
		seen.add(reference);
		selected.push({
			reference,
			path,
			content: readFileSync(path, "utf8").trim(),
		});
	}
	const content =
		selected.length === 1
			? (selected[0]?.content ?? "")
			: selected
					.map(
						({ reference, content: body }) => `--- ${reference} ---\n${body}`,
					)
					.join("\n\n");
	return `${content}\n\n---\nSources:\n${selected.map(({ path }) => `- ${path}`).join("\n")}`;
}

export function readSkillPackage(
	skills: CatalogSkill[],
	name: string,
	references: string[],
): string {
	const target = resolveSkillRead(skills, name, references);
	if (!target) {
		throw new Error(
			`Unknown skill "${name}". Available: ${skills.map((skill) => skill.name).join(", ") || "none"}`,
		);
	}
	const selectedReferences = target.references.filter(
		(reference) => !isOwnSkillDocument(reference, target.skill),
	);
	return selectedReferences.length
		? readReferences(target.skill, selectedReferences, skills)
		: formatSkill(target.skill);
}
