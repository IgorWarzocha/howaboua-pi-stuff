import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

function configPath(cwd: string): string {
	return join(cwd, ".pi", "shepherdr.json");
}

export async function isMasterDirectory(cwd: string): Promise<boolean> {
	const path = configPath(cwd);
	const value = await readConfig(path);
	if (!value || !("master" in value)) return false;
	if (typeof value["master"] === "boolean") return value["master"];
	throw new Error(`${path} master must be boolean`);
}

export async function enableMasterDirectory(cwd: string): Promise<string> {
	const directory = join(cwd, ".pi");
	const path = configPath(cwd);
	const value = (await readConfig(path)) ?? {};
	value["master"] = true;
	await mkdir(directory, { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
	return path;
}

async function readConfig(
	path: string,
): Promise<Record<string, unknown> | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
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
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return value as Record<string, unknown>;
}
