import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, rename, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const manifestPath = ".openai/hosting.json";

interface GitOptions {
	env?: NodeJS.ProcessEnv | undefined;
	signal?: AbortSignal | undefined;
}

export async function git(
	cwd: string,
	args: string[],
	{ env = process.env, signal }: GitOptions = {},
) {
	if (!isAbsolute(cwd))
		throw new Error("Git working directory must be absolute");
	return (
		await runFile("git", args, {
			cwd,
			env,
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: 120_000,
			signal,
		})
	).stdout;
}

export function requireGitWorktreeEnvironment() {
	if (
		["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].some(
			(key) => process.env[key],
		)
	) {
		throw new Error(
			"Unset Git directory and index overrides before using Site source",
		);
	}
}

export async function verifyCommitProject(
	root: string,
	commitSha: string,
	projectId: string,
	options: GitOptions,
) {
	const entry = await git(
		root,
		["ls-tree", commitSha, "--", manifestPath],
		options,
	);
	if (!/^100(?:644|755) blob /.test(entry)) {
		throw new Error(`Site source must commit a regular ${manifestPath} file`);
	}
	const source = await git(
		root,
		["show", `${commitSha}:${manifestPath}`],
		options,
	);
	let manifest: unknown;
	try {
		manifest = JSON.parse(source);
	} catch {
		throw new Error(`Committed ${manifestPath} must contain valid JSON`);
	}
	if (!isRecord(manifest) || manifest["project_id"] !== projectId) {
		throw new Error(
			`Committed ${manifestPath} does not match the selected Site`,
		);
	}
}

export async function newCheckoutPath(projectDir: unknown, cwd: string) {
	if (typeof projectDir !== "string" || !projectDir.trim()) {
		throw new Error("site.open requires project_dir for a new local directory");
	}
	const destination = resolve(cwd, projectDir);
	try {
		await lstat(destination);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return destination;
		throw error;
	}
	throw new Error("site.open requires a directory that does not exist yet");
}

export async function openSource(
	destination: string,
	projectId: string,
	credential: unknown,
	signal?: AbortSignal,
) {
	requireGitWorktreeEnvironment();
	const root = await mkdtemp(join(dirname(destination), ".sites-open-"));
	try {
		const env = { ...process.env };
		for (const key of Object.keys(env)) {
			if (key.startsWith("GIT_CONFIG")) delete env[key];
		}
		env["GIT_CONFIG_NOSYSTEM"] = "1";
		env["GIT_CONFIG_GLOBAL"] = "/dev/null";
		const options = { env, signal };
		await git(root, ["init", "--template="], options);
		const remote = await sourceRemote(root, credential, { signal });
		await remote.run([
			"fetch",
			"--no-tags",
			"--no-recurse-submodules",
			remote.url,
			remote.ref,
		]);
		const commitSha = (
			await git(root, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], options)
		).trim();
		await verifyCommitProject(root, commitSha, projectId, options);
		await git(
			root,
			[
				"-c",
				"core.hooksPath=/dev/null",
				"checkout",
				"-b",
				remote.branch,
				commitSha,
			],
			options,
		);
		signal?.throwIfAborted();
		// Reserve the destination without replacing an existing checkout.
		await mkdir(destination);
		try {
			await rename(root, destination);
		} catch (error) {
			await rmdir(destination);
			throw error;
		}
		return {
			project_id: projectId,
			checkout_path: destination,
			commit_sha: commitSha,
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

export async function pushCommit(
	root: string,
	commitSha: string,
	credential: unknown,
	signal?: AbortSignal,
) {
	const remote = await sourceRemote(root, credential, { signal }, true);
	await remote.run([
		"push",
		"--no-verify",
		"--no-follow-tags",
		"--no-signed",
		"--recurse-submodules=no",
		"--porcelain",
		remote.url,
		`${commitSha}:${remote.ref}`,
	]);
}

async function sourceRemote(
	root: string,
	credential: unknown,
	options: GitOptions,
	push = false,
) {
	const { url, branch, token } = parseCredential(credential);
	const ref = `refs/heads/${branch}`;
	await git(root, ["check-ref-format", ref], options).catch(() => {
		throw new Error("Sites returned an invalid source branch");
	});
	const rewritten = (
		await git(root, ["ls-remote", "--get-url", url], options)
	).trim();
	const pushRewrite =
		push &&
		(await git(root, ["config", "--null", "--list"], options))
			.split("\0")
			.some((entry) => {
				const index = entry.indexOf("\n");
				return (
					index !== -1 &&
					/^url\..*\.pushinsteadof$/i.test(entry.slice(0, index)) &&
					url.startsWith(entry.slice(index + 1))
				);
			});
	if (rewritten !== url || pushRewrite) {
		throw new Error(
			"Git rewrites the Site source URL. Remove the matching URL rewrite before retrying",
		);
	}

	const env: NodeJS.ProcessEnv = {
		...(options.env ?? process.env),
		GIT_TERMINAL_PROMPT: "0",
	};
	for (const key of Object.keys(env)) {
		if (key.startsWith("GIT_TRACE") || key === "GIT_CURL_VERBOSE")
			delete env[key];
	}
	delete env["GIT_ASKPASS"];
	delete env["GIT_SSL_NO_VERIFY"];
	const config = [
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.askPass=",
		"-c",
		"credential.helper=",
		"-c",
		"http.extraHeader=",
		"-c",
		`http.${url}.extraHeader=`,
		"-c",
		"http.followRedirects=false",
		"-c",
		`http.${url}.followRedirects=false`,
		"-c",
		`http.${url}.sslVerify=true`,
	];
	if (token) {
		env["SITES_GIT_AUTHORIZATION"] = `Authorization: Bearer ${token}`;
		config.push(`--config-env=http.${url}.extraHeader=SITES_GIT_AUTHORIZATION`);
	} else if (
		env["CODEX_NETWORK_PROXY_ACTIVE"] === "1" &&
		env["HTTPS_PROXY"] &&
		(await readGitConfig(
			root,
			["--get-urlmatch", "http.proxy", url],
			options,
		)) === "\0"
	) {
		// An empty Git setting would bypass Work's authenticated HTTPS proxy.
		config.push(`--config-env=http.${url}.proxy=HTTPS_PROXY`);
	}
	return {
		url,
		ref,
		branch,
		async run(args: string[]) {
			try {
				return await git(root, [...config, ...args], { ...options, env });
			} catch (error) {
				options.signal?.throwIfAborted();
				const stderr =
					error instanceof Error && "stderr" in error
						? String(error.stderr)
						: "";
				if (push && /non-fast-forward|fetch first/i.test(stderr)) {
					throw new Error(
						"Site source was not pushed. Reconcile remote changes and retry with a clean commit",
					);
				}
				if (!push && /couldn't find remote ref/i.test(stderr)) {
					throw new Error(
						"No committed source was found on the Site's source branch",
					);
				}
				const recovery = token
					? "Retry to obtain fresh access, then check the Site's source access and network if it still fails"
					: "Use an environment with authenticated access to the Site's source proxy";
				throw new Error(
					`Could not ${push ? "push" : "fetch"} Site source. ${recovery}`,
				);
			}
		},
	};
}

async function readGitConfig(
	root: string,
	args: string[],
	options: GitOptions,
) {
	try {
		return await git(root, ["config", "--null", ...args], options);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === 1)
			return "";
		throw error;
	}
}

function parseCredential(credential: unknown) {
	if (!isRecord(credential))
		throw new Error("Sites returned no source repository access");
	const {
		remote_url: remote,
		branch,
		auth_mode: auth,
		token,
		token_expires_at: expires,
	} = credential;
	if (typeof branch !== "string" || !branch || branch.startsWith("-")) {
		throw new Error("Sites returned an invalid source branch");
	}
	const url = typeof remote === "string" ? URL.parse(remote) : null;
	if (
		url?.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.href.includes("=")
	) {
		throw new Error("Sites did not return a credential-free HTTPS source URL");
	}
	if (
		expires != null &&
		(typeof expires !== "string" || !(Date.parse(expires) > Date.now()))
	) {
		throw new Error(
			"Site source access expired. Retry to request fresh access",
		);
	}
	if (auth === "work_proxy") return { url: url.href, branch };
	if (
		auth === "http_extra_header" &&
		typeof token === "string" &&
		/^[A-Za-z0-9._~+/=-]+$/.test(token)
	) {
		return { url: url.href, branch, token };
	}
	throw new Error("Sites returned unsupported source authentication");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
