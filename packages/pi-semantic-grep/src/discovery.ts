import { execFile } from "node:child_process";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { type SemanticGrepConfig, STANDARD_EXCLUDE_DIRS } from "./config.js";
import type { FileMetadata } from "./files.js";

const execFileAsync = promisify(execFile);

export interface DiscoveryResult {
	files: FileMetadata[];
	source: "filesystem" | "git";
	skipped: number;
	unavailableDirectories: string[];
	unavailableFiles: Set<string>;
}

interface Inspection {
	metadata?: FileMetadata;
	unavailable: boolean;
}

interface IgnoreScope {
	base: string;
	matcher: Ignore;
}

function excludedDirectories(config: SemanticGrepConfig): Set<string> {
	return new Set([...STANDARD_EXCLUDE_DIRS, ...config.indexing.excludeDirs]);
}

function excludedByDirectory(rel: string, excluded: Set<string>): boolean {
	return rel.split(/[\\/]/).some((part) => excluded.has(part));
}

async function inspectFile(
	root: string,
	rel: string,
	config: SemanticGrepConfig,
	excluded: Set<string>,
): Promise<Inspection> {
	if (
		excludedByDirectory(rel, excluded) ||
		!config.indexing.includeExtensions.includes(path.extname(rel).toLowerCase())
	)
		return { unavailable: false };

	const abs = path.join(root, rel);
	try {
		const entry = await lstat(abs);
		if (entry.isSymbolicLink() && !config.indexing.followSymlinks)
			return { unavailable: false };
		const fileStat = entry.isSymbolicLink() ? await stat(abs) : entry;
		if (!fileStat.isFile() || fileStat.size > config.indexing.maxFileBytes)
			return { unavailable: false };
		return {
			metadata: {
				file: rel,
				size: fileStat.size,
				mtimeMs: fileStat.mtimeMs,
				ctimeMs: fileStat.ctimeMs,
			},
			unavailable: false,
		};
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EACCES" || code === "EPERM")
			return { unavailable: true };
		throw error;
	}
}

async function gitCandidates(root: string): Promise<string[] | undefined> {
	try {
		const { stdout } = await execFileAsync(
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
		return stdout.split("\0").filter(Boolean);
	} catch {
		return undefined;
	}
}

async function loadIgnoreScope(
	root: string,
	dir: string,
): Promise<IgnoreScope | undefined> {
	try {
		const rules = await readFile(path.join(root, dir, ".gitignore"), "utf8");
		return {
			base: dir.split(path.sep).join("/"),
			matcher: ignore().add(rules),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function ignoredByScopes(
	rel: string,
	directory: boolean,
	scopes: IgnoreScope[],
): boolean {
	const normalized = rel.split(path.sep).join("/");
	let ignored = false;
	for (const scope of scopes) {
		if (scope.base && !normalized.startsWith(`${scope.base}/`)) continue;
		const local = scope.base
			? normalized.slice(scope.base.length + 1)
			: normalized;
		if (!local) continue;
		const result = scope.matcher.checkIgnore(directory ? `${local}/` : local);
		if (result.rule) ignored = result.ignored;
	}
	return ignored;
}

async function filesystemCandidates(
	root: string,
	config: SemanticGrepConfig,
): Promise<{
	files: string[];
	skipped: number;
	unavailableDirectories: string[];
}> {
	const excluded = excludedDirectories(config);
	const files: string[] = [];
	const unavailableDirectories: string[] = [];
	let skipped = 0;
	const walk = async (
		dir: string,
		inheritedScopes: IgnoreScope[],
	): Promise<void> => {
		const localScope = config.indexing.useGitIgnore
			? await loadIgnoreScope(root, dir)
			: undefined;
		const scopes = localScope
			? [...inheritedScopes, localScope]
			: inheritedScopes;
		let entries;
		try {
			entries = await readdir(path.join(root, dir), { withFileTypes: true });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
				skipped++;
				unavailableDirectories.push(dir);
				return;
			}
			throw error;
		}
		for (const entry of entries) {
			const rel = dir ? path.join(dir, entry.name) : entry.name;
			if (entry.isSymbolicLink()) {
				if (
					config.indexing.followSymlinks &&
					!ignoredByScopes(rel, false, scopes)
				)
					files.push(rel);
				continue;
			}
			if (entry.isDirectory()) {
				if (excluded.has(entry.name) || ignoredByScopes(rel, true, scopes))
					continue;
				await walk(rel, scopes);
			} else if (entry.isFile() && !ignoredByScopes(rel, false, scopes)) {
				files.push(rel);
			}
		}
	};
	await walk("", []);
	return { files, skipped, unavailableDirectories };
}

export async function discoverFiles(
	root: string,
	config: SemanticGrepConfig,
): Promise<DiscoveryResult> {
	const fromGit = config.indexing.useGitIgnore
		? await gitCandidates(root)
		: undefined;
	const fallback = fromGit
		? undefined
		: await filesystemCandidates(root, config);
	const candidates = fromGit ?? fallback?.files ?? [];
	const files: FileMetadata[] = [];
	const unavailableFiles = new Set<string>();
	const excluded = excludedDirectories(config);
	let skipped = fallback?.skipped ?? 0;
	for (let start = 0; start < candidates.length; start += 256) {
		const batch = candidates.slice(start, start + 256);
		const inspections = await Promise.all(
			batch.map((rel) => inspectFile(root, rel, config, excluded)),
		);
		for (let index = 0; index < batch.length; index++) {
			const rel = batch[index];
			const inspection = inspections[index];
			if (!rel || !inspection) continue;
			if (inspection.metadata) files.push(inspection.metadata);
			else if (inspection.unavailable) {
				skipped++;
				unavailableFiles.add(rel);
			}
		}
	}
	if (files.length > config.indexing.maxFiles) {
		throw new Error(
			`semantic grep found ${files.length} indexable files, above indexing.maxFiles=${config.indexing.maxFiles}; narrow the project root or exclusions`,
		);
	}
	files.sort((a, b) => a.file.localeCompare(b.file));
	return {
		files,
		source: fromGit ? "git" : "filesystem",
		skipped,
		unavailableDirectories: fallback?.unavailableDirectories ?? [],
		unavailableFiles,
	};
}
