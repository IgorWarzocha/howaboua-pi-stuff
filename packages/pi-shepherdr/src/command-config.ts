import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function commandConfigPath(): string {
	return resolve(getAgentDir(), "pi-shepherdr.json");
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readExtensionCommands(): Record<string, string> {
	const path = commandConfigPath();
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return {};
		throw new Error(`Could not read ${path}: ${String(error)}`, {
			cause: error,
		});
	}
	try {
		const document: unknown = JSON.parse(source);
		if (!object(document)) throw new Error("configuration must be an object");
		const commands = document["extensionCommands"];
		if (commands === undefined) return {};
		if (!object(commands))
			throw new Error("extensionCommands must be an object");
		const entries = Object.entries(commands);
		const validated: [string, string][] = [];
		for (const [name, description] of entries) {
			if (!/^[^\s/]+$/.test(name))
				throw new Error(
					"extension command names must be nonempty, without slashes or whitespace",
				);
			if (typeof description !== "string" || !description.trim())
				throw new Error(
					`extensionCommands.${name} must be a nonempty description`,
				);
			validated.push([name, description]);
		}
		return Object.fromEntries(validated);
	} catch (error) {
		throw new Error(`Could not read ${path}: ${String(error)}`, {
			cause: error,
		});
	}
}
