import { execFile } from "node:child_process";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { type SemanticGrepConfig, STANDARD_EXCLUDE_DIRS } from "./config.js";
import type { FileMetadata } from "./files.js";

const execFileAsync = promisify(execFile);
const METADATA_CONCURRENCY = 32;

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

function fileLimitError(config: SemanticGrepConfig): Error {
	return new Error(
		`semantic grep found more than indexing.maxFiles=${config.indexing.maxFiles} indexable files; narrow the project root or exclusions`,
	);
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
	signal?: AbortSignal,
): Promise<Inspection> {
	signal?.throwIfAborted();
	if (
		excludedByDirectory(rel, excluded) ||
		!config.indexing.includeExtensions.includes(path.extname(rel).toLowerCase())
	)
		return { unavailable: false };

	const abs = path.join(root, rel);
	try {
		const entry = await lstat(abs);
		signal?.throwIfAborted();
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

async function gitCandidates(
	root: string,
	signal?: AbortSignal,
): Promise<string[] | undefined> {
	try {
		const [listed, removed] = await Promise.all([
			execFileAsync(
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
				{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024, signal },
			),
			execFileAsync(
				"git",
				["-C", root, "ls-files", "--deleted", "-z", "--", "."],
				{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024, signal },
			),
		]);
		signal?.throwIfAborted();
		const deleted = new Set(removed.stdout.split("\0").filter(Boolean));
		return listed.stdout
			.split("\0")
			.filter((file) => file && !deleted.has(file));
	} catch {
		signal?.throwIfAborted();
		return undefined;
	}
}

async function loadIgnoreScope(
	root: string,
	dir: string,
	signal?: AbortSignal,
): Promise<IgnoreScope | undefined> {
	signal?.throwIfAborted();
	try {
		const rules = await readFile(path.join(root, dir, ".gitignore"), "utf8");
		signal?.throwIfAborted();
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
	signal?: AbortSignal,
): Promise<{
	files: FileMetadata[];
	skipped: number;
	unavailableDirectories: string[];
	unavailableFiles: Set<string>;
}> {
	const excluded = excludedDirectories(config);
	const files: FileMetadata[] = [];
	const unavailableDirectories: string[] = [];
	const unavailableFiles = new Set<string>();
	let skipped = 0;
	const inspect = async (rel: string): Promise<void> => {
		const inspection = await inspectFile(root, rel, config, excluded, signal);
		if (inspection.metadata) {
			files.push(inspection.metadata);
			if (files.length > config.indexing.maxFiles) throw fileLimitError(config);
		} else if (inspection.unavailable) {
			skipped++;
			unavailableFiles.add(rel);
		}
	};
	const walk = async (
		dir: string,
		inheritedScopes: IgnoreScope[],
	): Promise<void> => {
		signal?.throwIfAborted();
		let localScope: IgnoreScope | undefined;
		try {
			localScope = config.indexing.useGitIgnore
				? await loadIgnoreScope(root, dir, signal)
				: undefined;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EACCES" || code === "EPERM") {
				skipped++;
				unavailableDirectories.push(dir);
				return;
			}
			throw error;
		}
		const scopes = localScope
			? [...inheritedScopes, localScope]
			: inheritedScopes;
		let entries;
		try {
			entries = await readdir(path.join(root, dir), { withFileTypes: true });
			signal?.throwIfAborted();
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
			signal?.throwIfAborted();
			const rel = dir ? path.join(dir, entry.name) : entry.name;
			if (entry.isSymbolicLink()) {
				if (
					config.indexing.followSymlinks &&
					!ignoredByScopes(rel, false, scopes)
				)
					await inspect(rel);
				continue;
			}
			if (entry.isDirectory()) {
				if (excluded.has(entry.name) || ignoredByScopes(rel, true, scopes))
					continue;
				await walk(rel, scopes);
			} else if (entry.isFile() && !ignoredByScopes(rel, false, scopes))
				await inspect(rel);
		}
	};
	await walk("", []);
	return { files, skipped, unavailableDirectories, unavailableFiles };
}

export async function discoverFiles(
	root: string,
	config: SemanticGrepConfig,
	signal?: AbortSignal,
): Promise<DiscoveryResult> {
	signal?.throwIfAborted();
	const fromGit = config.indexing.useGitIgnore
		? await gitCandidates(root, signal)
		: undefined;
	const fallback = fromGit
		? undefined
		: await filesystemCandidates(root, config, signal);
	const candidates = fromGit ?? [];
	const files: FileMetadata[] = fallback?.files ?? [];
	const unavailableFiles = fallback?.unavailableFiles ?? new Set<string>();
	const excluded = excludedDirectories(config);
	let skipped = fallback?.skipped ?? 0;
	let cursor = 0;
	let failure: unknown;
	const worker = async (): Promise<void> => {
		while (failure === undefined) {
			try {
				signal?.throwIfAborted();
				const index = cursor++;
				const rel = candidates[index];
				if (!rel) return;
				const inspection = await inspectFile(
					root,
					rel,
					config,
					excluded,
					signal,
				);
				if (inspection.metadata) files.push(inspection.metadata);
				if (files.length > config.indexing.maxFiles)
					throw fileLimitError(config);
				else if (inspection.unavailable) {
					skipped++;
					unavailableFiles.add(rel);
				}
			} catch (error) {
				failure = error;
			}
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(METADATA_CONCURRENCY, candidates.length) },
			worker,
		),
	);
	if (failure !== undefined) throw failure;
	signal?.throwIfAborted();
	files.sort((a, b) => a.file.localeCompare(b.file));
	return {
		files,
		source: fromGit ? "git" : "filesystem",
		skipped,
		unavailableDirectories: fallback?.unavailableDirectories ?? [],
		unavailableFiles,
	};
}
