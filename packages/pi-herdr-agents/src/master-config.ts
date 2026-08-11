import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function configPath(cwd: string): string {
	return join(cwd, ".pi", "herdr.json");
}

export async function isMasterDirectory(cwd: string): Promise<boolean> {
	const path = configPath(cwd);
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw new Error(
			`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (
		typeof value === "object" &&
		value !== null &&
		"master" in value &&
		typeof value.master === "boolean"
	) {
		return value.master;
	}
	throw new Error(`${path} must contain a boolean master field`);
}

export async function enableMasterDirectory(cwd: string): Promise<string> {
	const directory = join(cwd, ".pi");
	const path = configPath(cwd);
	await mkdir(directory, { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({ master: true }, null, 2)}\n`,
		"utf8",
	);
	return path;
}
