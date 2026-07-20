import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface CheckResult {
	command: string;
	passed: boolean;
	output: string;
}

export interface ValidationRun {
	passed: boolean;
	results: CheckResult[];
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function readPackageJson(
	packagePath: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(packagePath, "utf8"));
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

async function findPackageCheckDirs(
	repoRoot: string,
	changedFiles: string[],
): Promise<string[]> {
	const directories = new Set<string>();
	for (const relativePath of changedFiles) {
		let current = path.dirname(path.join(repoRoot, relativePath));
		while (current.startsWith(repoRoot)) {
			const packagePath = path.join(current, "package.json");
			const packageJson = await readPackageJson(packagePath);
			const scripts = packageJson?.["scripts"];
			if (
				typeof scripts === "object" &&
				scripts !== null &&
				typeof (scripts as Record<string, unknown>)["check"] === "string"
			) {
				directories.add(current);
				break;
			}
			if (current === repoRoot) break;
			const parent = path.dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}
	return [...directories].sort();
}

async function detectPackageManager(
	repoRoot: string,
): Promise<{ command: string; args: string[] }> {
	const packageJson = await readPackageJson(
		path.join(repoRoot, "package.json"),
	);
	const configured = packageJson?.["packageManager"];
	const name =
		typeof configured === "string" ? configured.split("@")[0] : undefined;
	if (name === "bun" || (await pathExists(path.join(repoRoot, "bun.lock"))))
		return { command: "bun", args: ["run", "check"] };
	if (
		name === "pnpm" ||
		(await pathExists(path.join(repoRoot, "pnpm-lock.yaml")))
	)
		return { command: "pnpm", args: ["run", "check"] };
	if (name === "yarn" || (await pathExists(path.join(repoRoot, "yarn.lock"))))
		return { command: "yarn", args: ["run", "check"] };
	return { command: "npm", args: ["run", "check"] };
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args].join(" ");
}

async function runCheck(
	pi: ExtensionAPI,
	cwd: string,
	command: string,
	args: string[],
): Promise<CheckResult> {
	const result = await pi.exec(command, args, { cwd, timeout: 10 * 60_000 });
	const output = [result.stdout.trim(), result.stderr.trim()]
		.filter(Boolean)
		.join("\n")
		.slice(-8_000);
	return {
		command: formatCommand(command, args),
		passed: result.code === 0,
		output,
	};
}

export async function runExistingChecks(
	pi: ExtensionAPI,
	repoRoot: string,
	changedFiles: string[],
	mergeBase?: string,
): Promise<ValidationRun> {
	const results: CheckResult[] = [
		await runCheck(
			pi,
			repoRoot,
			"git",
			mergeBase ? ["diff", "--check", mergeBase] : ["diff", "--check"],
		),
	];
	const packageDirs = await findPackageCheckDirs(repoRoot, changedFiles);
	if (packageDirs.length > 0) {
		const runner = await detectPackageManager(repoRoot);
		for (const packageDir of packageDirs) {
			results.push(await runCheck(pi, packageDir, runner.command, runner.args));
		}
	} else if (await pathExists(path.join(repoRoot, "Cargo.toml"))) {
		results.push(
			await runCheck(pi, repoRoot, "cargo", ["check", "--workspace"]),
		);
	} else if (await pathExists(path.join(repoRoot, "go.mod"))) {
		results.push(await runCheck(pi, repoRoot, "go", ["test", "./..."]));
	}

	return {
		passed: results.every((result) => result.passed),
		results,
	};
}

export function formatValidationFeedback(validation: ValidationRun): string {
	return validation.results
		.map((result) => {
			const status = result.passed ? "passed" : "failed";
			return `${status}: ${result.command}${result.output ? `\n${result.output}` : ""}`;
		})
		.join("\n\n");
}
