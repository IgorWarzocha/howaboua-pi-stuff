import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parsePulseFrontmatter } from "./frontmatter.js";
import {
	type PulseQuietHours,
	type PulseSchedule,
	parsePulseQuietHours,
	parsePulseSchedule,
} from "./schedule.js";

const git = promisify(execFile);
export interface Repository {
	root: string;
	stateRoot: string;
}
export interface Definition {
	id: string;
	title: string;
	path: string;
	body: string;
	enabled: boolean;
	scheduleText: string;
	schedule: PulseSchedule;
	quietHours?: PulseQuietHours;
}
export type CatalogItem =
	| { id: string; definition: Definition }
	| { id: string; path: string; error: string };

export async function repository(cwd: string): Promise<Repository> {
	const root = await realpath(cwd);
	let stdout: string;
	try {
		({ stdout } = await git(
			"git",
			["rev-parse", "--path-format=absolute", "--git-common-dir"],
			{ cwd: root },
		));
	} catch (error) {
		if (
			error instanceof Error &&
			"stderr" in error &&
			String(error.stderr).includes("not a git repository")
		)
			return { root, stateRoot: join(root, ".pi", "pulses", ".runtime") };
		throw new Error(
			"Could not resolve this workspace. Check its Git access and retry.",
		);
	}
	const common = await realpath(stdout.trim());
	// rev-parse from the common directory resolves the original worktree, not its caller.
	const result = await git("git", [
		"--git-dir",
		common,
		"worktree",
		"list",
		"--porcelain",
	]);
	const first = result.stdout.split("\n")[0];
	if (!first?.startsWith("worktree "))
		throw new Error("A non-bare Git repository is required.");
	return {
		root: await realpath(first.slice(9)),
		stateRoot: join(common, "pi-pulses"),
	};
}

export async function catalog(repo: Repository): Promise<CatalogItem[]> {
	const root = join(repo.root, ".pi", "pulses");
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
	return Promise.all(
		entries
			.filter((entry) => entry.name.endsWith(".md"))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(async (entry): Promise<CatalogItem> => {
				const id = entry.name.slice(0, -3);
				const path = join(root, entry.name);
				try {
					if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
						throw new Error("Use a self-explanatory kebab-case filename.");
					if (!entry.isFile() || (await realpath(path)) !== resolve(path))
						throw new Error(
							"Pulse definitions must be regular Markdown files, not symlinks.",
						);
					const { data, body } = parsePulseFrontmatter(
						await readFile(path, "utf8"),
					);
					if (
						data["title"] !== undefined &&
						(typeof data["title"] !== "string" || !data["title"].trim())
					)
						throw new Error("title must be nonempty text");
					if (
						data["enabled"] !== undefined &&
						typeof data["enabled"] !== "boolean"
					)
						throw new Error("enabled must be true or false");
					const scheduleText = String(data["schedule"] ?? "");
					const schedule = parsePulseSchedule(scheduleText);
					if (!schedule) throw new Error("invalid or missing schedule");
					const quietHours =
						data["quietHours"] === undefined
							? undefined
							: parsePulseQuietHours(String(data["quietHours"]));
					if (quietHours === null)
						throw new Error("quietHours must use HH:MM-HH:MM");
					if (!body.trim()) throw new Error("Pulse instructions are empty");
					return {
						id,
						definition: {
							id,
							path,
							title:
								typeof data["title"] === "string" ? data["title"].trim() : id,
							body,
							scheduleText,
							schedule,
							enabled: data["enabled"] !== false,
							...(quietHours ? { quietHours } : {}),
						},
					};
				} catch (error) {
					return { id, path, error: String(error) };
				}
			}),
	);
}

export function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
