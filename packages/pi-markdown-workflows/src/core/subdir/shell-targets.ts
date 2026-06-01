import fs from "node:fs";

import { resolvePath } from "./paths.js";

function shellCommandParts(value: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: "'" | '"' | "" = "";
	let escaped = false;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (!char) continue;
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = "";
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				parts.push(current);
				current = "";
			}
			continue;
		}
		if (
			char === ";" ||
			char === "|" ||
			(char === "&" && value[index + 1] === "&")
		) {
			if (current) {
				parts.push(current);
				current = "";
			}
			parts.push(";");
			if (
				(char === "|" && value[index + 1] === "|") ||
				(char === "&" && value[index + 1] === "&")
			) {
				index += 1;
			}
			continue;
		}
		current += char;
	}
	if (current) parts.push(current);
	return parts.filter(Boolean);
}

function gitCommandInfo(parts: string[], index: number) {
	let cursor = index + 1;
	let directory: string | undefined;
	while (cursor < parts.length) {
		const part = parts[cursor];
		if (part === "-C") {
			directory = parts[cursor + 1];
			cursor += 2;
			continue;
		}
		if (part?.startsWith("--git-dir=") || part?.startsWith("--work-tree=")) {
			cursor += 1;
			continue;
		}
		break;
	}
	const subcommand = parts[cursor]?.toLowerCase() ?? "";
	return { subcommand, directory, subcommandIndex: cursor };
}

function isDiscoveryCommandAt(parts: string[], index: number): boolean {
	const command = parts[index]?.toLowerCase() ?? "";
	const names = new Set([
		"ls",
		"find",
		"rg",
		"grep",
		"fd",
		"tree",
		"cat",
		"sed",
		"head",
		"tail",
		"nl",
		"wc",
		"stat",
		"file",
		"du",
		"git",
	]);
	if (command !== "git") return names.has(command);
	const { subcommand } = gitCommandInfo(parts, index);
	return subcommand === "ls-files" || subcommand === "grep";
}

function isPathOutputCommandAt(parts: string[], index: number): boolean {
	const command = parts[index]?.toLowerCase() ?? "";
	if (["ls", "find", "rg", "grep", "fd", "tree"].includes(command)) return true;
	if (command !== "git") return false;
	const { subcommand } = gitCommandInfo(parts, index);
	return subcommand === "ls-files" || subcommand === "grep";
}

export function isPathOutputShellCommand(value: string): boolean {
	const parts = shellCommandParts(value);
	for (let index = 0; index < parts.length; index += 1) {
		if (isPathOutputCommandAt(parts, index)) return true;
	}
	return false;
}

export function shellOutputToolName(value: string): "grep" | "shell" {
	const parts = shellCommandParts(value);
	for (let index = 0; index < parts.length; index += 1) {
		const command = parts[index]?.toLowerCase() ?? "";
		if (command === "rg" || command === "grep") return "grep";
		if (
			command === "git" &&
			gitCommandInfo(parts, index).subcommand === "grep"
		) {
			return "grep";
		}
	}
	return "shell";
}

function pathExists(candidate: string, base: string): boolean {
	return fs.existsSync(resolvePath(candidate, base));
}

function maybePushPath(paths: string[], item: string, base: string): void {
	if (item === ".") {
		paths.push(base);
		return;
	}
	if (item.startsWith("/")) {
		if (fs.existsSync(item)) paths.push(resolvePath(item, base));
		return;
	}
	if (
		(item.startsWith("./") || item.startsWith("../") || item.includes("/")) &&
		pathExists(item, base)
	) {
		paths.push(resolvePath(item, base));
	}
}

export function isDiscoveryShellCommand(value: string): boolean {
	const parts = shellCommandParts(value);
	for (let index = 0; index < parts.length; index += 1) {
		if (isDiscoveryCommandAt(parts, index)) return true;
	}
	return false;
}

export function shellTargets(value: string, base: string): string[] {
	const parts = shellCommandParts(value);
	if (!parts.length) return [base];
	const paths: string[] = [];
	let cwd = base;
	let scanningDiscoveryCommand = false;
	let discoveryBase = cwd;
	let skipNextPathLikeToken = false;
	for (let index = 0; index < parts.length; index += 1) {
		const item = parts[index];
		if (!item) continue;
		if (item === ";") {
			scanningDiscoveryCommand = false;
			discoveryBase = cwd;
			skipNextPathLikeToken = false;
			continue;
		}
		if (item === "cd") {
			const next = parts[index + 1];
			if (next) cwd = resolvePath(next, cwd);
			index += 1;
			scanningDiscoveryCommand = false;
			continue;
		}
		if (isDiscoveryCommandAt(parts, index)) {
			scanningDiscoveryCommand = true;
			discoveryBase = cwd;
			skipNextPathLikeToken = item === "rg" || item === "grep";
			if (item.toLowerCase() === "git") {
				const { directory, subcommand, subcommandIndex } = gitCommandInfo(
					parts,
					index,
				);
				if (directory) {
					discoveryBase = resolvePath(directory, cwd);
					paths.push(discoveryBase);
				}
				skipNextPathLikeToken = subcommand === "grep";
				index = subcommandIndex;
			}
			continue;
		}
		if (!scanningDiscoveryCommand) continue;
		if (item.startsWith("-")) continue;
		if (item.includes("=")) continue;
		if (skipNextPathLikeToken) {
			skipNextPathLikeToken = false;
			continue;
		}
		maybePushPath(paths, item, discoveryBase);
	}
	if (!paths.length) return [cwd];
	return paths;
}

export function shellOutputBase(value: string, base: string): string {
	const parts = shellCommandParts(value);
	let cwd = base;
	for (let index = 0; index < parts.length; index += 1) {
		const item = parts[index];
		if (!item || item === ";") continue;
		if (item === "cd") {
			const next = parts[index + 1];
			if (next) cwd = resolvePath(next, cwd);
			index += 1;
			continue;
		}
		if (isDiscoveryCommandAt(parts, index)) {
			if (item.toLowerCase() !== "git") return cwd;
			const { directory } = gitCommandInfo(parts, index);
			return directory ? resolvePath(directory, cwd) : cwd;
		}
	}
	return cwd;
}
