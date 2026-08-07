import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, type Dirent } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	CHECKPOINT_SCHEMA,
	type CheckpointEntry,
	type CheckpointManifest,
	type NotebookCheckpointIdentity,
} from "./checkpoint-format.ts";
import { checkpointSource, restoreSource } from "./checkpoint-runtime.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";

export const NOTEBOOK_CHECKPOINT_MAX_BYTES = 256 * 1024 * 1024;
const NOTEBOOK_CHECKPOINT_MIN_BYTES = 8 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PAYLOAD_NAME = /^checkpoint-[0-9a-f-]+\.bin$/;
const CHECKPOINT_DIRECTORY_NAME = /^[0-9a-f]{64}$/;

export type { NotebookCheckpointIdentity } from "./checkpoint-format.ts";

export interface NotebookCheckpointSummary {
	restored: string[];
	skipped: Array<{ name: string; reason: string }>;
	message?: string | undefined;
}

export function resolveNotebookCheckpointMaxBytes(maxHeapMiB: number): number {
	const heapRelative = Math.floor(maxHeapMiB * 1024 * 1024 / 8);
	return Math.min(NOTEBOOK_CHECKPOINT_MAX_BYTES, Math.max(NOTEBOOK_CHECKPOINT_MIN_BYTES, heapRelative));
}

export function garbageCollectSupersededNotebookCheckpoints(identity: NotebookCheckpointIdentity): void {
	const current = checkpointPaths(identity).directory;
	const sessions = resolve(current, "..");
	const family = sessionFamily(identity.session);
	let entries: Dirent[];
	try {
		entries = readdirSync(sessions, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || !CHECKPOINT_DIRECTORY_NAME.test(entry.name)) continue;
		const directory = join(sessions, entry.name);
		if (directory === current) continue;
		const manifest = readManifest(join(directory, "checkpoint.json"));
		if (!manifest || manifest.project !== identity.project || sessionFamily(manifest.session) !== family) continue;
		rmSync(directory, { recursive: true, force: true });
	}
}

export async function writeNotebookCheckpoint(
	kernel: DenoJupyterKernel,
	identity: NotebookCheckpointIdentity,
	baselineNames: ReadonlySet<string>,
	maxBytes: number,
): Promise<CheckpointManifest> {
	const paths = checkpointPaths(identity);
	mkdirSync(paths.directory, { recursive: true });
	const names = [...new Set(await kernel.complete("", 0))].sort();
	const skippedInvalid = names
		.filter((name) => !baselineNames.has(name) && !IDENTIFIER.test(name))
		.map((name) => ({ name, reason: "unsupported identifier" }));
	const candidates = names.filter((name) => !baselineNames.has(name) && IDENTIFIER.test(name));
	const payload = `checkpoint-${randomUUID()}.bin`;
	const source = checkpointSource({
		candidates,
		payloadPath: join(paths.directory, payload),
		manifestPath: paths.manifest,
		directory: paths.directory,
		identity,
		payload,
		skippedInvalid,
		maxBytes,
	});
	const result = await kernel.execute(source);
	if (result.status !== "ok") throw new Error(`Notebook checkpoint failed: ${result.errorText ?? "unknown error"}`);
	const manifest = readManifest(paths.manifest);
	if (!manifest) throw new Error("Notebook checkpoint did not produce a valid manifest");
	return manifest;
}

export async function restoreNotebookCheckpoint(
	kernel: DenoJupyterKernel,
	identity: NotebookCheckpointIdentity,
	maxBytes: number,
): Promise<NotebookCheckpointSummary> {
	const paths = checkpointPaths(identity);
	if (!existsSync(paths.manifest)) return { restored: [], skipped: [] };
	const manifest = readManifest(paths.manifest);
	if (!manifest) return { restored: [], skipped: [], message: "Notebook checkpoint was invalid and was not restored" };
	if (
		manifest.schema !== CHECKPOINT_SCHEMA
		|| manifest.project !== identity.project
		|| manifest.session !== identity.session
	) {
		return { restored: [], skipped: manifest.skipped, message: "Notebook checkpoint identity was incompatible and was not restored" };
	}
	const payloadPath = join(paths.directory, manifest.payload);
	if (!isValidCheckpointPayload(manifest, payloadPath, maxBytes)) {
		return { restored: [], skipped: manifest.skipped, message: "Notebook checkpoint payload was missing or invalid and was not restored" };
	}
	const result = await kernel.execute(restoreSource(manifest, payloadPath));
	if (result.status !== "ok") {
		return {
			restored: [],
			skipped: manifest.skipped,
			message: `Notebook checkpoint was incompatible and was not restored: ${result.errorText ?? "unknown error"}`,
		};
	}
	return { restored: manifest.entries.map((entry) => entry.name), skipped: manifest.skipped };
}

function checkpointPaths(identity: NotebookCheckpointIdentity): { directory: string; manifest: string } {
	const key = createHash("sha256")
		.update(`${resolve(identity.project)}\0${identity.session}`)
		.digest("hex");
	const directory = join(
		identity.agentDir,
		"cache",
		"pi-codex-conversion",
		"notebook-mode",
		"sessions",
		key,
	);
	return { directory, manifest: join(directory, "checkpoint.json") };
}

function sessionFamily(session: string): string {
	const separator = session.indexOf("\0");
	return separator === -1 ? session : session.slice(0, separator);
}

function readManifest(path: string): CheckpointManifest | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || value["schema"] !== CHECKPOINT_SCHEMA) return undefined;
		if (
			typeof value["project"] !== "string"
			|| typeof value["session"] !== "string"
			|| typeof value["deno"] !== "string"
			|| typeof value["v8"] !== "string"
			|| typeof value["payload"] !== "string"
				|| typeof value["createdAt"] !== "string"
			|| !Array.isArray(value["entries"])
			|| !Array.isArray(value["skipped"])
			|| !PAYLOAD_NAME.test(value["payload"])
			|| basename(value["payload"]) !== value["payload"]
		) return undefined;
		const entries = value["entries"].map(parseEntry);
		const skipped = value["skipped"].map(parseSkipped);
		if (entries.some((entry) => !entry) || skipped.some((entry) => !entry)) return undefined;
		return {
			schema: CHECKPOINT_SCHEMA,
			project: value["project"],
			session: value["session"],
			deno: value["deno"],
			v8: value["v8"],
			payload: value["payload"],
			createdAt: value["createdAt"],
			entries: entries as CheckpointEntry[],
			skipped: skipped as Array<{ name: string; reason: string }>,
		};
	} catch {
		return undefined;
	}
}

function isValidCheckpointPayload(manifest: CheckpointManifest, path: string, maxBytes: number): boolean {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return false;
		let offset = 0;
		const names = new Set<string>();
		for (const entry of manifest.entries) {
			if (names.has(entry.name) || entry.offset !== offset) return false;
			names.add(entry.name);
			offset += entry.length;
		}
		return offset === stat.size;
	} catch {
		return false;
	}
}

function parseEntry(value: unknown): CheckpointEntry | undefined {
	if (!isRecord(value)) return undefined;
	const { name, offset, length, kind } = value;
	return typeof name === "string" && IDENTIFIER.test(name)
		&& (kind === undefined || kind === "value" || kind === "function")
		&& Number.isSafeInteger(offset) && (offset as number) >= 0
		&& Number.isSafeInteger(length) && (length as number) >= 0
		? { name, kind: kind === "function" ? "function" : "value", offset: offset as number, length: length as number }
		: undefined;
}

function parseSkipped(value: unknown): { name: string; reason: string } | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value["name"] === "string" && typeof value["reason"] === "string"
		? { name: value["name"], reason: value["reason"] }
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
