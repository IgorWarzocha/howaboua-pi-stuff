import {
	type FileHandle,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	git,
	requireGitWorktreeEnvironment,
	verifyCommitProject,
} from "./source-git.js";

export interface ProjectContext {
	root: string;
	manifestPath: string;
}
export async function projectContext(
	projectDir: unknown,
	cwd = process.cwd(),
): Promise<ProjectContext> {
	if (projectDir && typeof projectDir !== "string")
		throw new Error("project_dir must name a directory");
	const requested =
		typeof projectDir === "string" && projectDir
			? resolve(cwd, projectDir)
			: cwd;
	const requestedStat = await stat(requested);
	if (!requestedStat.isDirectory())
		throw new Error("project_dir must name a directory");
	let gitRoot;
	try {
		gitRoot = (await git(requested, ["rev-parse", "--show-toplevel"])).trim();
	} catch {
		// Site creation can precede Git initialization.
	}
	if (projectDir && gitRoot && resolve(gitRoot) !== requested) {
		throw new Error(
			"project_dir must be the Git repository root, not a nested directory",
		);
	}
	const root = gitRoot || requested;
	return { root, manifestPath: join(root, ".openai", "hosting.json") };
}

export async function acquireHostingLock(context: ProjectContext) {
	await mkdir(dirname(context.manifestPath), { recursive: true });
	const lockPath = join(dirname(context.manifestPath), "hosting.lock");
	let handle: FileHandle | undefined;
	try {
		handle = await open(lockPath, "wx", 0o600);
		await handle.writeFile(`${process.pid}\n`);
	} catch (error) {
		await handle?.close();
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			throw new Error(`Another Sites operation holds ${lockPath}`);
		}
		throw error;
	}
	const acquired = handle;
	let released = false;
	return async () => {
		if (released) return;
		released = true;
		await acquired.close();
		await rm(lockPath, { force: true });
	};
}

export async function readHosting(
	context: ProjectContext,
): Promise<Record<string, unknown>> {
	try {
		const value: unknown = JSON.parse(
			await readFile(context.manifestPath, "utf8"),
		);
		if (!isRecord(value)) {
			throw new Error("manifest must contain a JSON object");
		}
		return value;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return {};
		throw new Error(
			`${context.manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function persistProjectId(
	context: ProjectContext,
	projectId: string,
) {
	const manifest = await readHosting(context);
	if (manifest["project_id"] && manifest["project_id"] !== projectId) {
		throw new Error(
			`${context.manifestPath} already contains a different project_id`,
		);
	}
	manifest["project_id"] = projectId;
	await mkdir(dirname(context.manifestPath), { recursive: true });
	const temporary = `${context.manifestPath}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(temporary, context.manifestPath);
}

export async function resolveProjectId(
	params: Record<string, unknown>,
	context: ProjectContext,
) {
	const manifest = await readHosting(context);
	const supplied = params["project_id"];
	if (supplied !== undefined && typeof supplied !== "string") {
		throw new Error("project_id must be a string");
	}
	if (
		supplied &&
		manifest["project_id"] &&
		supplied !== manifest["project_id"]
	) {
		throw new Error("project_id does not match .openai/hosting.json");
	}
	const projectId = supplied || manifest["project_id"];
	if (typeof projectId !== "string" || !projectId.trim()) {
		throw new Error("Supply project_id or set it in .openai/hosting.json");
	}
	return projectId;
}

export async function inspectCleanCommit(
	context: ProjectContext,
	projectId: string,
	signal?: AbortSignal,
) {
	requireGitWorktreeEnvironment();
	const options = { signal };
	let root: string;
	try {
		root = (
			await git(context.root, ["rev-parse", "--show-toplevel"], options)
		).trim();
	} catch {
		throw new Error("Source save requires a Git repository");
	}
	const status = await git(
		root,
		["status", "--porcelain=v1", "--untracked-files=all"],
		options,
	);
	if (status.trim())
		throw new Error("Source save requires a clean Git worktree");
	const commitSha = (
		await git(root, ["rev-parse", "--verify", "HEAD^{commit}"], options)
	).trim();
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commitSha))
		throw new Error("Could not resolve the current Git commit");
	await verifyCommitProject(root, commitSha, projectId, options);
	return { root, commitSha };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
