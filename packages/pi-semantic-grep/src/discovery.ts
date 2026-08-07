import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { type SemanticGrepConfig, STANDARD_EXCLUDE_DIRS } from "./config.js";
import type { FileMetadata } from "./files.js";

export interface DiscoveryResult {
	files: FileMetadata[];
	source: "filesystem" | "git";
	skipped: number;
}

function excludedByDirectory(rel: string, excluded: Set<string>): boolean {
	return rel.split(/[\\/]/).some((part) => excluded.has(part));
}

interface Inspection {
	metadata?: FileMetadata;
	unavailable: boolean;
}

function inspectFile(
	root: string,
	rel: string,
	config: SemanticGrepConfig,
	excluded: Set<string>,
): Inspection {
	if (
		excludedByDirectory(rel, excluded) ||
		!config.indexing.includeExtensions.includes(path.extname(rel).toLowerCase())
	)
		return { unavailable: false };

	const abs = path.join(root, rel);
	try {
		const entry = lstatSync(abs);
		if (entry.isSymbolicLink() && !config.indexing.followSymlinks)
			return { unavailable: false };
		const stat = entry.isSymbolicLink() ? statSync(abs) : entry;
		if (!stat.isFile() || stat.size > config.indexing.maxFileBytes)
			return { unavailable: false };
		return {
			metadata: { file: rel, size: stat.size, mtimeMs: stat.mtimeMs },
			unavailable: false,
		};
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EACCES" || code === "EPERM")
			return { unavailable: true };
		throw error;
	}
}

function gitCandidates(root: string): string[] | undefined {
	const result = spawnSync(
		"git",
		[
			"-C",
			root,
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			".",
		],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	if (result.status !== 0) return undefined;
	return result.stdout.split("\0").filter(Boolean);
}

function rootIgnore(root: string, config: SemanticGrepConfig): Ignore {
	const matcher = ignore();
	if (!config.indexing.useGitIgnore) return matcher;
	try {
		matcher.add(readFileSync(path.join(root, ".gitignore"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return matcher;
}

function filesystemCandidates(
	root: string,
	config: SemanticGrepConfig,
): { files: string[]; skipped: number } {
	const excluded = excludedDirectories(config);
	const matcher = rootIgnore(root, config);
	const files: string[] = [];
	let skipped = 0;
	const walk = (dir: string): void => {
		let entries;
		try {
			entries = readdirSync(path.join(root, dir), { withFileTypes: true });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
				skipped++;
				return;
			}
			throw error;
		}
		for (const entry of entries) {
			const rel = dir ? path.join(dir, entry.name) : entry.name;
			const normalized = rel.split(path.sep).join("/");
			if (entry.isSymbolicLink()) {
				if (config.indexing.followSymlinks && !matcher.ignores(normalized))
					files.push(rel);
				continue;
			}
			if (entry.isDirectory()) {
				if (excluded.has(entry.name) || matcher.ignores(`${normalized}/`))
					continue;
				walk(rel);
			} else if (entry.isFile() && !matcher.ignores(normalized)) {
				files.push(rel);
			}
		}
	};
	walk("");
	return { files, skipped };
}

function excludedDirectories(config: SemanticGrepConfig): Set<string> {
	return new Set([...STANDARD_EXCLUDE_DIRS, ...config.indexing.excludeDirs]);
}

export function discoverFiles(
	root: string,
	config: SemanticGrepConfig,
): DiscoveryResult {
	const fromGit = config.indexing.useGitIgnore
		? gitCandidates(root)
		: undefined;
	const fallback = fromGit ? undefined : filesystemCandidates(root, config);
	const candidates = fromGit ?? fallback?.files ?? [];
	const files: FileMetadata[] = [];
	const excluded = excludedDirectories(config);
	let skipped = fallback?.skipped ?? 0;
	for (const rel of candidates) {
		const inspection = inspectFile(root, rel, config, excluded);
		if (inspection.metadata) files.push(inspection.metadata);
		else if (inspection.unavailable) skipped++;
	}
	if (files.length > config.indexing.maxFiles) {
		throw new Error(
			`semantic grep found ${files.length} indexable files, above indexing.maxFiles=${config.indexing.maxFiles}; narrow the project root or exclusions`,
		);
	}
	files.sort((a, b) => a.file.localeCompare(b.file));
	return { files, source: fromGit ? "git" : "filesystem", skipped };
}
