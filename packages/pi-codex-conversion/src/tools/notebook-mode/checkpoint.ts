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
import {
	MAX_PROJECT_ENTRIES,
	MAX_PROJECT_MANIFEST_BYTES,
	MAX_PROJECT_NAME_BYTES,
	parseProjectBindingMetadata,
	type ProjectStateBaseline,
} from "./project-state-format.ts";

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

export function removeNotebookCheckpoint(identity: NotebookCheckpointIdentity): void {
	rmSync(checkpointPaths(identity).directory, { recursive: true, force: true });
}

export function notebookCheckpointBindingNames(identity: NotebookCheckpointIdentity, maxBytes: number): string[] {
	const manifest = readManifest(checkpointPaths(identity).manifest);
	return manifest?.project === identity.project
		&& manifest.session === identity.session
		&& isValidCheckpointPayload(manifest, join(checkpointPaths(identity).directory, manifest.payload), maxBytes)
		? manifest.entries.map(({ name }) => name)
		: [];
}

export async function writeNotebookCheckpoint(
	kernel: DenoJupyterKernel,
	identity: NotebookCheckpointIdentity,
	baselineNames: ReadonlySet<string>,
	maxBytes: number,
	projectBaseline: ProjectStateBaseline,
	excludeNames: ReadonlySet<string> = new Set(),
): Promise<CheckpointManifest> {
	const paths = checkpointPaths(identity);
	mkdirSync(paths.directory, { recursive: true });
	const names = [...new Set(await kernel.complete("", 0))].sort();
	const privateNames = names.filter((name) => !baselineNames.has(name) && !excludeNames.has(name));
	if (privateNames.length > MAX_PROJECT_ENTRIES) {
		throw new Error(`Notebook checkpoint exceeds ${MAX_PROJECT_ENTRIES} top-level values`);
	}
	if (privateNames.some((name) => Buffer.byteLength(name) > MAX_PROJECT_NAME_BYTES)) {
		throw new Error(`Notebook checkpoint name exceeds ${MAX_PROJECT_NAME_BYTES} bytes`);
	}
	const skippedInvalid = privateNames
		.filter((name) => !IDENTIFIER.test(name))
		.map((name) => ({ name, reason: "unsupported identifier" }));
	const candidates = privateNames.filter((name) => IDENTIFIER.test(name));
	const payload = `checkpoint-${randomUUID()}.bin`;
	const previousPayload = readManifest(paths.manifest)?.payload;
	const source = checkpointSource({
		candidates,
		payloadPath: join(paths.directory, payload),
		manifestPath: paths.manifest,
		directory: paths.directory,
		identity,
		projectGeneration: projectBaseline.generation,
		projectNames: projectBaseline.entries.map(({ name }) => name),
		payload,
		...(previousPayload ? { previousPayload } : {}),
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
	projectBaseline: ProjectStateBaseline,
	signal?: AbortSignal,
): Promise<NotebookCheckpointSummary> {
	signal?.throwIfAborted();
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
	signal?.throwIfAborted();
	const excluded = sessionCheckpointProjectExclusions(manifest, projectBaseline);
	const result = await kernel.execute(restoreSource(manifest, payloadPath, excluded), { signal });
	if (result.status !== "ok") {
		return {
			restored: [],
			skipped: manifest.skipped,
			message: `Notebook checkpoint was incompatible and was not restored: ${result.errorText ?? "unknown error"}`,
		};
	}
	const restored = manifest.entries.map((entry) => entry.name).filter((name) => !excluded.has(name));
	return {
		restored,
		skipped: manifest.skipped,
		...(excluded.size > 0 ? { message: "Session checkpoint came from an older project generation; current project bindings took precedence" } : {}),
	};
}

export function sessionCheckpointProjectExclusions(
	manifest: Pick<CheckpointManifest, "projectGeneration" | "projectNames">,
	projectBaseline: ProjectStateBaseline,
): Set<string> {
	return manifest.projectGeneration && manifest.projectGeneration !== projectBaseline.generation
		? new Set([
			...projectBaseline.entries.map(({ name }) => name),
			...(manifest.projectNames ?? []),
		])
		: new Set();
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
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_MANIFEST_BYTES) return undefined;
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
			|| value["entries"].length > MAX_PROJECT_ENTRIES
			|| value["skipped"].length > MAX_PROJECT_ENTRIES
			|| "projectNames" in value && (
				!Array.isArray(value["projectNames"])
				|| value["projectNames"].length > MAX_PROJECT_ENTRIES
				|| !value["projectNames"].every((name) =>
					typeof name === "string"
					&& IDENTIFIER.test(name)
					&& Buffer.byteLength(name) <= MAX_PROJECT_NAME_BYTES)
			)
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
			...(typeof value["projectGeneration"] === "string" ? { projectGeneration: value["projectGeneration"] } : {}),
			...(Array.isArray(value["projectNames"]) ? { projectNames: value["projectNames"] as string[] } : {}),
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
	const metadata = parseProjectBindingMetadata(value);
	return typeof name === "string" && IDENTIFIER.test(name)
		&& Buffer.byteLength(name) <= MAX_PROJECT_NAME_BYTES
		&& (kind === undefined || kind === "value" || kind === "function")
		&& Number.isSafeInteger(offset) && (offset as number) >= 0
		&& Number.isSafeInteger(length) && (length as number) >= 0
		&& metadata !== undefined
		? { name, kind: kind === "function" ? "function" : "value", offset: offset as number, length: length as number, ...metadata }
		: undefined;
}

function parseSkipped(value: unknown): { name: string; reason: string } | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value["name"] === "string"
		&& Buffer.byteLength(value["name"]) <= MAX_PROJECT_NAME_BYTES
		&& typeof value["reason"] === "string"
		&& Buffer.byteLength(value["reason"]) <= MAX_PROJECT_NAME_BYTES
		? { name: value["name"], reason: value["reason"] }
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
