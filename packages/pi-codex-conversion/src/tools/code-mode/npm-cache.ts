import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { acquireDirectoryLock } from "../notebook-mode/directory-lock.ts";

export const runImportCommand = promisify(execFile);

export function parseExactNpmImport(specifier: string): { name: string; version: string; subpath: string } {
	const match = /^npm:((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(\/[^\s?#]*)?$/.exec(specifier);
	if (!match) throw new Error(`Use an exact-version npm import: ${specifier}`);
	return { name: match[1]!, version: match[2]!, subpath: match[3] ?? "" };
}

/** Approval belongs to the existing user/agent import contract, not an invented install-time prompt. */
export async function cacheExactNpmImport(specifier: string, cacheDir: string, signal?: AbortSignal, includeOptional = false): Promise<{ cwd: string; bare: string }> {
	signal?.throwIfAborted();
	const { name, version, subpath } = parseExactNpmImport(specifier);
	const identity = `${name}@${version}`;
	const cwd = join(cacheDir, createHash("sha256").update(identity).digest("hex"));
	await mkdir(cwd, { recursive: true, mode: 0o700 });
	const lock = await acquireDirectoryLock(`${cwd}.lock`, { waitMs: 180_000, staleMs: 60_000, pollMs: 100, signal });
	if (!lock) throw new Error(`Could not prepare ${specifier}`);
	try {
		const manifest = join(cwd, "node_modules", name, "package.json");
		const completed = join(cwd, ".installed");
		let installed = false;
		try {
			const value: unknown = JSON.parse(await readFile(manifest, "utf8"));
			installed = !!value && typeof value === "object" && "version" in value && value.version === version
				&& await readFile(completed, "utf8") === identity;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		if (!installed) {
			await writeFile(join(cwd, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { [name]: version } }), { mode: 0o600 });
			try {
				await runImportCommand("npm", ["install", "--ignore-scripts", ...(includeOptional ? ["--include=optional"] : []), "--no-audit", "--no-fund", "--save-exact"], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024, signal });
			} catch (error) {
				signal?.throwIfAborted();
				throw new Error(`Could not install ${identity} without lifecycle scripts. Check registry access; packages needing install scripts are unavailable.`, { cause: error });
			}
			const value: unknown = JSON.parse(await readFile(manifest, "utf8"));
			if (!value || typeof value !== "object" || !("version" in value) || value.version !== version) throw new Error(`Installed version does not match ${identity}`);
			await writeFile(completed, identity, { mode: 0o600 });
		}
		return { cwd, bare: `${name}${subpath}` };
	} finally {
		lock.release();
	}
}
