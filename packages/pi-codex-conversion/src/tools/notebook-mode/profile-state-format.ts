import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
	MAX_PROJECT_ENTRIES,
	MAX_PROJECT_MANIFEST_BYTES,
	MAX_PROJECT_NAME_BYTES,
	parseProjectBindingMetadata,
	type ProjectStateEntry,
} from "./project-state-format.ts";

export const PROFILE_STATE_SCHEMA = 1;
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PAYLOAD_NAME = /^profile-[0-9a-f-]+\.bin$/;
const HASH = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface ProfileStateManifest {
	schema: number;
	name: string;
	deno: string;
	v8: string;
	payload: string;
	createdAt: string;
	sourceProject: string;
	entries: ProjectStateEntry[];
	skipped: Array<{ name: string; reason: string }>;
}

export interface ProfileStateSummary {
	name: string;
	createdAt: string;
	sourceProject: string;
	values: number;
	definitions: number;
	skipped: number;
}

export function profileStatePaths(name: string, agentDir: string) {
	assertProfileName(name);
	const directory = join(agentDir, "cache", "pi-codex-conversion", "notebook-mode", "profiles", name);
	return { directory, manifest: join(directory, "profile.json"), lock: join(directory, "write.lock") };
}

export function profilesDirectory(agentDir: string): string {
	return join(agentDir, "cache", "pi-codex-conversion", "notebook-mode", "profiles");
}

export function assertProfileName(name: string): void {
	if (!PROFILE_NAME.test(name)) throw new Error("Notebook profile name must be 1-64 letters, numbers, dots, underscores, or hyphens and start with a letter or number");
}

export function readProfileStateManifest(path: string, expectedName?: string): ProfileStateManifest | undefined {
	try {
		if (statSync(path).size > MAX_PROJECT_MANIFEST_BYTES) return undefined;
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || value["schema"] !== PROFILE_STATE_SCHEMA) return undefined;
		if (
			typeof value["name"] !== "string" || !PROFILE_NAME.test(value["name"])
			|| typeof value["deno"] !== "string"
			|| typeof value["v8"] !== "string"
			|| typeof value["payload"] !== "string"
			|| typeof value["createdAt"] !== "string"
			|| typeof value["sourceProject"] !== "string"
			|| !Array.isArray(value["entries"])
			|| !Array.isArray(value["skipped"])
			|| value["entries"].length > MAX_PROJECT_ENTRIES
			|| value["skipped"].length > MAX_PROJECT_ENTRIES
			|| !PAYLOAD_NAME.test(value["payload"])
			|| basename(value["payload"]) !== value["payload"]
		) return undefined;
		if (expectedName !== undefined && value["name"] !== expectedName) return undefined;
		const entries = value["entries"].map(parseEntry);
		const skipped = value["skipped"].map(parseSkipped);
		if (entries.some((entry) => !entry) || skipped.some((entry) => !entry)) return undefined;
		return {
			schema: PROFILE_STATE_SCHEMA,
			name: value["name"],
			deno: value["deno"],
			v8: value["v8"],
			payload: value["payload"],
			createdAt: value["createdAt"],
			sourceProject: value["sourceProject"],
			entries: entries as ProjectStateEntry[],
			skipped: skipped as Array<{ name: string; reason: string }>,
		};
	} catch {
		return undefined;
	}
}

export function assertSafeProfileDirectory(directory: string, agentDir: string): void {
	const root = resolve(agentDir);
	const target = resolve(directory);
	const suffix = relative(root, target);
	if (!suffix || suffix.startsWith("..") || suffix.includes("\0")) throw new Error("Notebook profile path escaped agent storage");
	let current = root;
	for (const part of suffix.split(/[\\/]+/)) {
		current = join(current, part);
		if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
			throw new Error(`Notebook profile storage cannot use symlinked path: ${current}`);
		}
	}
}

export function readProfileStatePayload(manifest: ProfileStateManifest, path: string, maxBytes: number): Buffer | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return undefined;
		const payload = readFileSync(path);
		const names = new Set<string>();
		let offset = 0;
		for (const entry of manifest.entries) {
			if (names.has(entry.name) || entry.offset !== offset || entry.offset + entry.length > payload.length) return undefined;
			names.add(entry.name);
			if (hashProfileBytes(payload.subarray(entry.offset, entry.offset + entry.length)) !== entry.hash) return undefined;
			offset += entry.length;
		}
		return offset === payload.length ? payload : undefined;
	} catch {
		return undefined;
	}
}

export function profileSummary(manifest: ProfileStateManifest): ProfileStateSummary {
	const values = manifest.entries.filter(({ kind }) => kind === "value").length;
	return {
		name: manifest.name,
		createdAt: manifest.createdAt,
		sourceProject: manifest.sourceProject,
		values,
		definitions: manifest.entries.length - values,
		skipped: manifest.skipped.length,
	};
}

export function hashProfileBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function parseEntry(value: unknown): ProjectStateEntry | undefined {
	if (!isRecord(value)) return undefined;
	const { name, kind, offset, length, hash } = value;
	const metadata = parseProjectBindingMetadata(value);
	return typeof name === "string" && IDENTIFIER.test(name) && Buffer.byteLength(name) <= MAX_PROJECT_NAME_BYTES
		&& (kind === "value" || kind === "function")
		&& Number.isSafeInteger(offset) && (offset as number) >= 0
		&& Number.isSafeInteger(length) && (length as number) >= 0
		&& typeof hash === "string" && HASH.test(hash)
		&& metadata !== undefined
		? { name, kind, offset: offset as number, length: length as number, hash, ...metadata }
		: undefined;
}

function parseSkipped(value: unknown): { name: string; reason: string } | undefined {
	return isRecord(value)
		&& typeof value["name"] === "string"
		&& Buffer.byteLength(value["name"]) <= MAX_PROJECT_NAME_BYTES
		&& typeof value["reason"] === "string"
		? { name: value["name"], reason: value["reason"] }
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
