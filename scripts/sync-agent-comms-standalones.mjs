#!/usr/bin/env node
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const common = ["guidance.ts", "settings-navigation.ts", "timestamps.ts"];
const sources = {
	"pi-notes-compaction": [
		...common,
		"notes",
		"board/context-briefing.ts",
		"board/delivery.ts",
	],
	"pi-agent-board": [...common, "board"],
};

/** Standalone packages ship their own source, without a runtime dependency on Comms. */
export function includeCommsStandalones(packageDirs, files) {
	const result = new Set(packageDirs);
	for (const [dir, paths] of Object.entries(sources)) {
		if (
			files.some((file) =>
				paths.some(
					(path) =>
						file === `packages/pi-agent-comms/src/${path}` ||
						file.startsWith(`packages/pi-agent-comms/src/${path}/`),
				),
			)
		)
			result.add(dir);
	}
	return [...result].sort();
}

function filesUnder(path) {
	if (!existsSync(path)) return [];
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
		const child = join(path, entry.name);
		return entry.isDirectory() ? filesUnder(child) : [child];
	});
}

export function syncCommsStandalones(write = false) {
	const sourceRoot = join(root, "packages/pi-agent-comms/src");
	const differences = [];
	for (const [dir, paths] of Object.entries(sources)) {
		const targetRoot = join(root, "packages", dir, "src");
		const expected = new Map();
		for (const path of paths) {
			const source = join(sourceRoot, path);
			if (!existsSync(source))
				throw new Error(`Missing canonical source: ${source}`);
			const files = path.endsWith(".ts") ? [source] : filesUnder(source);
			for (const file of files)
				expected.set(relative(sourceRoot, file), readFileSync(file));
		}
		for (const [path, bytes] of expected) {
			const target = join(targetRoot, path);
			if (existsSync(target) && readFileSync(target).equals(bytes)) continue;
			differences.push(relative(root, target));
			if (write) {
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, bytes);
			}
		}
		for (const file of filesUnder(targetRoot)) {
			if (expected.has(relative(targetRoot, file))) continue;
			differences.push(relative(root, file));
			if (write) rmSync(file);
		}
	}
	return differences;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== "--write"))
		throw new Error("Usage: sync-agent-comms-standalones.mjs [--write]");
	const write = args.includes("--write");
	const differences = syncCommsStandalones(write);
	if (!write && differences.length) {
		console.error(
			`${differences.length} standalone source files differ. Run bun run comms:sync.\n${differences.slice(0, 12).join("\n")}`,
		);
		process.exitCode = 1;
	} else
		console.log(
			write
				? `Synced ${differences.length} standalone source files.`
				: "Agent Comms standalone sources match.",
		);
}
