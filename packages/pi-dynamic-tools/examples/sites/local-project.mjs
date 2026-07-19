import { execFile } from "node:child_process";
import {
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const askPass = join(
	dirname(fileURLToPath(import.meta.url)),
	"git-askpass.mjs",
);

export async function projectContext(projectDir) {
	const requested = projectDir ? resolve(projectDir) : process.cwd();
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

export async function acquireHostingLock(context) {
	await mkdir(dirname(context.manifestPath), { recursive: true });
	const lockPath = join(dirname(context.manifestPath), "hosting.lock");
	let handle;
	try {
		handle = await open(lockPath, "wx", 0o600);
		await handle.writeFile(`${process.pid}\n`);
	} catch (error) {
		await handle?.close();
		if (error.code === "EEXIST") {
			throw new Error(`Another Sites operation holds ${lockPath}`);
		}
		throw error;
	}
	let released = false;
	return async () => {
		if (released) return;
		released = true;
		await handle.close();
		await rm(lockPath, { force: true });
	};
}

export async function readHosting(context) {
	try {
		const value = JSON.parse(await readFile(context.manifestPath, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("manifest must contain a JSON object");
		}
		return value;
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw new Error(`${context.manifestPath}: ${error.message}`);
	}
}

export async function persistProjectId(context, projectId) {
	const manifest = await readHosting(context);
	if (manifest.project_id && manifest.project_id !== projectId) {
		throw new Error(
			`${context.manifestPath} already contains a different project_id`,
		);
	}
	manifest.project_id = projectId;
	await mkdir(dirname(context.manifestPath), { recursive: true });
	const temporary = `${context.manifestPath}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(temporary, context.manifestPath);
}

export async function resolveProjectId(params, context) {
	const manifest = await readHosting(context);
	const supplied = params.project_id;
	if (supplied !== undefined && typeof supplied !== "string") {
		throw new Error("project_id must be a string");
	}
	if (supplied && manifest.project_id && supplied !== manifest.project_id) {
		throw new Error("project_id does not match .openai/hosting.json");
	}
	const projectId = supplied || manifest.project_id;
	if (!projectId) {
		throw new Error("No project_id supplied and .openai/hosting.json has none");
	}
	return projectId;
}

export async function inspectCleanCommit(context) {
	const root = (
		await git(context.root, ["rev-parse", "--show-toplevel"])
	).trim();
	const status = await git(root, [
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
	]);
	if (status.trim())
		throw new Error("version.save requires a clean Git worktree");
	const manifestRelative = ".openai/hosting.json";
	await git(root, ["ls-files", "--error-unmatch", manifestRelative]);
	const commitSha = (await git(root, ["rev-parse", "HEAD"])).trim();
	if (!/^[0-9a-f]{40,64}$/i.test(commitSha))
		throw new Error("Could not resolve the current Git commit");
	return { root, commitSha };
}

export async function pushCommit({ root, commitSha, credential }) {
	const remoteUrl = credential?.remote_url;
	const branch = credential?.branch;
	const token = credential?.token;
	const authMode = String(credential?.auth_mode ?? "").toLowerCase();
	if (
		![remoteUrl, branch, token].every(
			(value) => typeof value === "string" && value,
		)
	) {
		throw new Error(
			"Sites returned an incomplete source repository credential",
		);
	}
	const url = new URL(remoteUrl);
	if (url.protocol !== "https:" || url.username || url.password) {
		throw new Error(
			"Sites source repository URL must be credential-free HTTPS",
		);
	}
	await git(root, ["check-ref-format", `refs/heads/${branch}`]);

	const env = {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
	};
	if (authMode.includes("bearer")) {
		env.GIT_CONFIG_COUNT = "1";
		env.GIT_CONFIG_KEY_0 = "http.extraHeader";
		env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${token}`;
	} else {
		env.GIT_ASKPASS = askPass;
		env.SITES_GIT_TOKEN = token;
		env.SITES_GIT_USERNAME = "x-access-token";
	}
	await git(
		root,
		[
			"-c",
			"credential.helper=",
			"-c",
			"core.hooksPath=/dev/null",
			"push",
			"--no-verify",
			"--porcelain",
			remoteUrl,
			`${commitSha}:refs/heads/${branch}`,
		],
		env,
	);
}

async function git(cwd, args, env = process.env) {
	if (!isAbsolute(cwd))
		throw new Error("Git working directory must be absolute");
	try {
		const result = await runFile("git", args, {
			cwd,
			env,
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: 120_000,
		});
		return result.stdout;
	} catch (error) {
		const detail = String(error.stderr || error.message || "Git command failed")
			.replaceAll(env.SITES_GIT_TOKEN || "\0", "[redacted]")
			.trim();
		throw new Error(detail.slice(0, 2_000));
	}
}
