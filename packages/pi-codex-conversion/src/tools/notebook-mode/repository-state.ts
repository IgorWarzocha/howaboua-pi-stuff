import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { NOTEBOOK_CHECKPOINT_MAX_BYTES } from "./checkpoint.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";

const REPOSITORY_SCHEMA = 1;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 5_000;
const REPOSITORY_PAYLOAD_NAME = /^repository-[0-9a-f-]+\.bin$/;

interface RepositoryEntry {
	key: string;
	offset: number;
	length: number;
	hash: string;
}

interface RepositoryManifest {
	schema: number;
	project: string;
	generation: string;
	parentGeneration?: string | undefined;
	deno: string;
	v8: string;
	payload: string;
	createdAt: string;
	sourceSession: string;
	entries: RepositoryEntry[];
	skipped: Array<{ key: string; reason: string }>;
}

interface CandidateManifest {
	deno: string;
	v8: string;
	entries: Array<{ key: string; offset: number; length: number }>;
	skipped: Array<{ key: string; reason: string }>;
}

export interface RepositoryStateBaseline {
	generation: string;
	entries: Array<{ key: string; hash: string }>;
}

export interface RepositoryStateSummary {
	baseline: RepositoryStateBaseline;
	restored: string[];
	skipped: Array<{ key: string; reason: string }>;
	conflicts: string[];
	message?: string | undefined;
}

export async function restoreRepositoryState(
	kernel: DenoJupyterKernel,
	identity: { project: string; agentDir: string },
): Promise<RepositoryStateSummary> {
	const { project, agentDir } = identity;
	const paths = repositoryPaths(project, agentDir);
	const manifest = readRepositoryManifest(paths.manifest);
	if (!manifest) return emptySummary();
	if (manifest.project !== resolve(project)) {
		return { ...emptySummary(), message: "Repository notebook state identity was incompatible and was not restored" };
	}
	const payloadPath = join(paths.directory, manifest.payload);
	if (!readValidatedRepositoryPayload(manifest, payloadPath)) {
		return { ...emptySummary(), message: "Repository notebook state payload was missing or invalid and was not restored" };
	}
	const result = await kernel.execute(repositoryRestoreSource(manifest, payloadPath));
	if (result.status !== "ok") {
		return {
			...emptySummary(),
			message: `Repository notebook state was incompatible and was not restored: ${result.errorText ?? "unknown error"}`,
		};
	}
	return {
		baseline: baselineFromManifest(manifest),
		restored: manifest.entries.map(({ key }) => key),
		skipped: manifest.skipped,
		conflicts: listRepositoryConflicts(paths.directory),
	};
}

export async function writeRepositoryState(
	kernel: DenoJupyterKernel,
	identity: { project: string; session: string; agentDir: string },
	baseline: RepositoryStateBaseline,
): Promise<RepositoryStateSummary> {
	const paths = repositoryPaths(identity.project, identity.agentDir);
	mkdirSync(paths.directory, { recursive: true });
	const candidateId = randomUUID();
	const candidatePayloadPath = join(paths.directory, `candidate-${candidateId}.bin`);
	const candidateManifestPath = join(paths.directory, `candidate-${candidateId}.json`);
	try {
		const capture = await kernel.execute(repositoryCaptureSource(candidatePayloadPath, candidateManifestPath));
		if (capture.status !== "ok") {
			throw new Error(`Repository notebook checkpoint failed: ${capture.errorText ?? "unknown error"}`);
		}
		const candidate = readCandidateManifest(candidateManifestPath, candidatePayloadPath);
		if (!candidate) throw new Error("Repository notebook checkpoint did not produce a valid candidate");
		const committed = await withRepositoryLock(paths.lock, async () => {
			const current = readRepositoryManifest(paths.manifest);
			if (current && (current.deno !== candidate.deno || current.v8 !== candidate.v8)) {
				throw new Error("Repository notebook state uses an incompatible Deno/V8 version; the existing baseline was preserved");
			}
			const currentPayload = current
				? readValidatedRepositoryPayload(current, join(paths.directory, current.payload))
				: Buffer.alloc(0);
			if (!currentPayload) throw new Error("Existing repository notebook state payload is invalid; it was preserved without overwrite");
			const merged = mergeRepositoryState({
				baseline,
				current,
				candidate,
				candidatePayload: readFileSync(candidatePayloadPath),
				currentPayload,
			});
			if (merged.payload.length > NOTEBOOK_CHECKPOINT_MAX_BYTES) {
				throw new Error("Merged repository notebook state exceeds the repository checkpoint cap");
			}
			if (merged.conflicts.length > 0) writeConflict(paths.directory, identity, merged);
			let manifest = current;
			if (merged.changed) manifest = writeMergedState(paths, identity, current, candidate, merged);
			removeResolvedConflicts(paths.directory, new Set(merged.appliedKeys));
			return { manifest, conflicts: merged.conflicts };
		});
		if (!committed.manifest) return { ...emptySummary(), skipped: candidate.skipped, conflicts: committed.conflicts };
		const restore = await kernel.execute(repositoryRestoreSource(
			committed.manifest,
			join(paths.directory, committed.manifest.payload),
		));
		if (restore.status !== "ok") {
			throw new Error(`Merged repository notebook state could not be rebound: ${restore.errorText ?? "unknown error"}`);
		}
		return {
			baseline: baselineFromManifest(committed.manifest),
			restored: committed.manifest.entries.map(({ key }) => key),
			skipped: candidate.skipped,
			conflicts: committed.conflicts,
		};
	} finally {
		rmSync(candidatePayloadPath, { force: true });
		rmSync(candidateManifestPath, { force: true });
	}
}

export function formatRepositoryStateNotice(
	summary: RepositoryStateSummary,
	options: { inventory?: boolean } = {},
): string | undefined {
	if (summary.message) return summary.message;
	const parts = [
		options.inventory && summary.restored.length > 0 ? `Repository notebook state: repo contains ${summary.restored.join(", ")}` : undefined,
		summary.skipped.length > 0
			? `Repository state not published: ${summary.skipped.slice(0, 12).map(({ key, reason }) => `${key} (${reason})`).join(", ")}`
			: undefined,
		summary.conflicts.length > 0
			? `Repository state conflicts preserved without overwrite: ${summary.conflicts.join(", ")}`
			: undefined,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(". ") : undefined;
}

export function repositoryConflictDirectory(project: string, agentDir: string): string {
	return join(repositoryPaths(project, agentDir).directory, "conflicts");
}

function mergeRepositoryState(options: {
	baseline: RepositoryStateBaseline;
	current: RepositoryManifest | undefined;
	candidate: CandidateManifest;
	candidatePayload: Buffer;
	currentPayload: Buffer;
}) {
	const base = new Map(options.baseline.entries.map(({ key, hash }) => [key, hash]));
	const current = new Map((options.current?.entries ?? []).map((entry) => [entry.key, entry]));
	const candidate = new Map(options.candidate.entries.map((entry) => [entry.key, {
		...entry,
		hash: hashBytes(options.candidatePayload.subarray(entry.offset, entry.offset + entry.length)),
	}]));
	const skipped = new Set(options.candidate.skipped.map(({ key }) => key));
	const keys = [...new Set([...base.keys(), ...current.keys(), ...candidate.keys(), ...skipped])].sort();
	const parts: Buffer[] = [];
	const entries: RepositoryEntry[] = [];
	const conflictParts: Buffer[] = [];
	const conflictEntries: RepositoryEntry[] = [];
	const conflictDeletions: string[] = [];
	const conflicts: string[] = [];
	const appliedKeys: string[] = [];
	let offset = 0;
	let conflictOffset = 0;
	let candidateChangedAny = false;
	for (const key of keys) {
		const baseHash = base.get(key);
		const currentEntry = current.get(key);
		const candidateEntry = candidate.get(key);
		const candidateHash = skipped.has(key) ? baseHash : candidateEntry?.hash;
		const currentHash = currentEntry?.hash;
		const candidateChanged = candidateHash !== baseHash;
		const currentChanged = currentHash !== baseHash;
		candidateChangedAny ||= candidateChanged;
		let selected: { entry: RepositoryEntry; payload: Buffer } | undefined;
		if (candidateChanged && currentChanged && candidateHash !== currentHash) {
			conflicts.push(key);
			if (candidateEntry) {
				const bytes = options.candidatePayload.subarray(candidateEntry.offset, candidateEntry.offset + candidateEntry.length);
				conflictParts.push(bytes);
				conflictEntries.push({ key, offset: conflictOffset, length: bytes.length, hash: candidateEntry.hash });
				conflictOffset += bytes.length;
			} else conflictDeletions.push(key);
			if (currentEntry) selected = { entry: currentEntry, payload: options.currentPayload };
		} else if (candidateChanged) {
			appliedKeys.push(key);
			if (candidateEntry) selected = { entry: candidateEntry, payload: options.candidatePayload };
		} else if (currentEntry) {
			selected = { entry: currentEntry, payload: options.currentPayload };
		}
		if (!selected) continue;
		const bytes = selected.payload.subarray(selected.entry.offset, selected.entry.offset + selected.entry.length);
		parts.push(bytes);
		entries.push({ key, offset, length: bytes.length, hash: selected.entry.hash });
		offset += bytes.length;
	}
	const currentShape = JSON.stringify((options.current?.entries ?? []).map(({ key, hash }) => [key, hash]));
	const mergedShape = JSON.stringify(entries.map(({ key, hash }) => [key, hash]));
	return {
		changed: candidateChangedAny && mergedShape !== currentShape,
		entries,
		payload: Buffer.concat(parts),
		conflicts,
		appliedKeys,
		conflictEntries,
		conflictDeletions,
		conflictPayload: Buffer.concat(conflictParts),
	};
}

function writeMergedState(
	paths: ReturnType<typeof repositoryPaths>,
	identity: { project: string; session: string },
	current: RepositoryManifest | undefined,
	candidate: CandidateManifest,
	merged: ReturnType<typeof mergeRepositoryState>,
): RepositoryManifest {
	const generation = randomUUID();
	const payload = `repository-${generation}.bin`;
	const manifest: RepositoryManifest = {
		schema: REPOSITORY_SCHEMA,
		project: resolve(identity.project),
		generation,
		...(current ? { parentGeneration: current.generation } : {}),
		deno: candidate.deno,
		v8: candidate.v8,
		payload,
		createdAt: new Date().toISOString(),
		sourceSession: identity.session,
		entries: merged.entries,
		skipped: candidate.skipped,
	};
	writeFileSync(join(paths.directory, payload), merged.payload, { mode: 0o600 });
	const temporary = `${paths.manifest}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, paths.manifest);
	if (current?.payload && current.payload !== payload) rmSync(join(paths.directory, current.payload), { force: true });
	return manifest;
}

function writeConflict(
	directory: string,
	identity: { project: string; session: string },
	merged: ReturnType<typeof mergeRepositoryState>,
): void {
	const conflictDirectory = join(directory, "conflicts");
	mkdirSync(conflictDirectory, { recursive: true });
	const prefix = `${new Date().toISOString().replaceAll(":", "-")}-${createHash("sha256").update(identity.session).digest("hex").slice(0, 12)}-${randomUUID().slice(0, 8)}`;
	for (const entry of merged.conflictEntries) {
		const id = `${prefix}-${createHash("sha256").update(entry.key).digest("hex").slice(0, 12)}`;
		const bytes = merged.conflictPayload.subarray(entry.offset, entry.offset + entry.length);
		writeFileSync(join(conflictDirectory, `${id}.bin`), bytes, { mode: 0o600 });
		writeFileSync(join(conflictDirectory, `${id}.json`), `${JSON.stringify({
			schema: REPOSITORY_SCHEMA,
			project: resolve(identity.project),
			session: identity.session,
			createdAt: new Date().toISOString(),
			payload: `${id}.bin`,
			entries: [{ ...entry, offset: 0 }],
		}, null, 2)}\n`, { mode: 0o600 });
	}
	for (const key of merged.conflictDeletions) {
		const id = `${prefix}-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
		writeFileSync(join(conflictDirectory, `${id}.json`), `${JSON.stringify({
			schema: REPOSITORY_SCHEMA,
			project: resolve(identity.project),
			session: identity.session,
			createdAt: new Date().toISOString(),
			entries: [{ key, deleted: true }],
		}, null, 2)}\n`, { mode: 0o600 });
	}
}

function listRepositoryConflicts(directory: string): string[] {
	const conflictDirectory = join(directory, "conflicts");
	if (!existsSync(conflictDirectory)) return [];
	const keys = new Set<string>();
	for (const name of readDirectoryNames(conflictDirectory)) {
		if (!name.endsWith(".json")) continue;
		try {
			const value = JSON.parse(readFileSync(join(conflictDirectory, name), "utf8")) as unknown;
			if (!isRecord(value) || !Array.isArray(value["entries"])) continue;
			for (const entry of value["entries"]) if (isRecord(entry) && typeof entry["key"] === "string") keys.add(entry["key"]);
		} catch {}
	}
	return [...keys].sort();
}

function removeResolvedConflicts(directory: string, keys: ReadonlySet<string>): void {
	if (keys.size === 0) return;
	const conflictDirectory = join(directory, "conflicts");
	for (const name of readDirectoryNames(conflictDirectory)) {
		if (!name.endsWith(".json")) continue;
		const path = join(conflictDirectory, name);
		try {
			const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
			if (!isRecord(value) || !Array.isArray(value["entries"])) continue;
			const conflictKeys = value["entries"].flatMap((entry) => isRecord(entry) && typeof entry["key"] === "string" ? [entry["key"]] : []);
			if (!conflictKeys.some((key) => keys.has(key))) continue;
			if (typeof value["payload"] === "string") rmSync(join(conflictDirectory, value["payload"]), { force: true });
			rmSync(path, { force: true });
		} catch {}
	}
}

function readDirectoryNames(directory: string): string[] {
	try {
		return readdirSync(directory);
	} catch {
		return [];
	}
}

async function withRepositoryLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	let descriptor: number | undefined;
	while (descriptor === undefined) {
		try {
			descriptor = openSync(path, "wx", 0o600);
			writeFileSync(descriptor, `${process.pid}\n${Date.now()}\n`);
		} catch (error) {
			if (!isFileExistsError(error)) throw error;
			try {
				if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) unlinkSync(path);
			} catch {}
			if (Date.now() >= deadline) throw new Error("Timed out waiting for repository notebook checkpoint lock");
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	try {
		return await operation();
	} finally {
		closeSync(descriptor);
		rmSync(path, { force: true });
	}
}

function repositoryCaptureSource(payloadPath: string, manifestPath: string): string {
	return `{
  const { serialize } = await import("node:v8");
  const __max = ${NOTEBOOK_CHECKPOINT_MAX_BYTES};
  const __parts = [];
  const __entries = [];
  const __skipped = [];
  let __total = 0;
  for (const __key of Object.keys(globalThis.repo).sort()) {
    try {
      const __value = globalThis.repo[__key];
      if (typeof __value === "function") throw new Error("function or class");
      if (__value instanceof Promise) throw new Error("promise");
      if (__value instanceof WeakMap || __value instanceof WeakSet) throw new Error("weak collection");
      const __bytes = serialize(__value);
      if (__bytes.byteLength > __max) throw new Error("exceeds per-value checkpoint cap");
      if (__total + __bytes.byteLength > __max) throw new Error("exceeds total repository checkpoint cap");
      __entries.push({ key: __key, offset: __total, length: __bytes.byteLength });
      __parts.push(__bytes);
      __total += __bytes.byteLength;
    } catch (__error) {
      __skipped.push({ key: __key, reason: String(__error instanceof Error ? __error.message : __error).slice(0, 240) });
    }
  }
  const __payload = new Uint8Array(__total);
  let __offset = 0;
  for (const __part of __parts) { __payload.set(__part, __offset); __offset += __part.byteLength; }
  await Deno.writeFile(${JSON.stringify(payloadPath)}, __payload, { mode: 0o600 });
  await Deno.writeTextFile(${JSON.stringify(manifestPath)}, JSON.stringify({
    deno: Deno.version.deno,
    v8: Deno.version.v8,
    entries: __entries,
    skipped: __skipped,
  }), { mode: 0o600 });
  undefined;
}`;
}

function repositoryRestoreSource(manifest: RepositoryManifest, payloadPath: string): string {
	return `{
  const { deserialize } = await import("node:v8");
  if (Deno.version.deno !== ${JSON.stringify(manifest.deno)} || Deno.version.v8 !== ${JSON.stringify(manifest.v8)}) {
    throw new Error("repository checkpoint Deno/V8 version does not match the active kernel");
  }
  const __payload = await Deno.readFile(${JSON.stringify(payloadPath)});
	const __restored = [];
  for (const __entry of ${JSON.stringify(manifest.entries)}) {
	__restored.push([__entry.key, deserialize(__payload.subarray(__entry.offset, __entry.offset + __entry.length))]);
  }
	for (const __key of Object.keys(globalThis.repo)) delete globalThis.repo[__key];
	for (const [__key, __value] of __restored) globalThis.repo[__key] = __value;
  undefined;
}`;
}

function repositoryPaths(project: string, agentDir: string) {
	const key = createHash("sha256").update(resolve(project)).digest("hex");
	const directory = join(agentDir, "cache", "pi-codex-conversion", "notebook-mode", "repositories", key);
	return { directory, manifest: join(directory, "repository.json"), lock: join(directory, "write.lock") };
}

function readRepositoryManifest(path: string): RepositoryManifest | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || value["schema"] !== REPOSITORY_SCHEMA) return undefined;
		if (
			typeof value["project"] !== "string"
			|| typeof value["generation"] !== "string"
			|| typeof value["deno"] !== "string"
			|| typeof value["v8"] !== "string"
			|| typeof value["payload"] !== "string"
			|| typeof value["createdAt"] !== "string"
				|| typeof value["sourceSession"] !== "string"
			|| !Array.isArray(value["entries"])
			|| !Array.isArray(value["skipped"])
			|| !REPOSITORY_PAYLOAD_NAME.test(value["payload"])
			|| basename(value["payload"]) !== value["payload"]
		) return undefined;
		const entries = value["entries"].map(parseRepositoryEntry);
		const skipped = value["skipped"].map(parseSkipped);
		if (entries.some((entry) => !entry) || skipped.some((entry) => !entry)) return undefined;
		return {
			schema: REPOSITORY_SCHEMA,
			project: value["project"],
			generation: value["generation"],
			...(typeof value["parentGeneration"] === "string" ? { parentGeneration: value["parentGeneration"] } : {}),
			deno: value["deno"],
			v8: value["v8"],
			payload: value["payload"],
			createdAt: value["createdAt"],
			sourceSession: value["sourceSession"],
			entries: entries as RepositoryEntry[],
			skipped: skipped as Array<{ key: string; reason: string }>,
		};
	} catch {
		return undefined;
	}
}

function readCandidateManifest(path: string, payloadPath: string): CandidateManifest | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || typeof value["deno"] !== "string" || typeof value["v8"] !== "string") return undefined;
		if (!Array.isArray(value["entries"]) || !Array.isArray(value["skipped"])) return undefined;
		const payloadLength = statSync(payloadPath).size;
		const entries = value["entries"].map((entry) => parseCandidateEntry(entry, payloadLength));
		const skipped = value["skipped"].map(parseSkipped);
		if (entries.some((entry) => !entry) || skipped.some((entry) => !entry)) return undefined;
		return {
			deno: value["deno"],
			v8: value["v8"],
			entries: entries as CandidateManifest["entries"],
			skipped: skipped as CandidateManifest["skipped"],
		};
	} catch {
		return undefined;
	}
}

function readValidatedRepositoryPayload(manifest: RepositoryManifest, path: string): Buffer | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > NOTEBOOK_CHECKPOINT_MAX_BYTES) return undefined;
		const payload = readFileSync(path);
		const keys = new Set<string>();
		let offset = 0;
		for (const entry of manifest.entries) {
			if (keys.has(entry.key) || entry.offset !== offset || entry.offset + entry.length > payload.length) return undefined;
			keys.add(entry.key);
			const bytes = payload.subarray(entry.offset, entry.offset + entry.length);
			if (hashBytes(bytes) !== entry.hash) return undefined;
			offset += entry.length;
		}
		return offset === payload.length ? payload : undefined;
	} catch {
		return undefined;
	}
}

function parseRepositoryEntry(value: unknown): RepositoryEntry | undefined {
	if (!isRecord(value)) return undefined;
	const candidate = parseCandidateEntry(value, Number.MAX_SAFE_INTEGER);
	return candidate && typeof value["hash"] === "string"
		? { ...candidate, hash: value["hash"] }
		: undefined;
}

function parseCandidateEntry(value: unknown, payloadLength: number): CandidateManifest["entries"][number] | undefined {
	if (!isRecord(value)) return undefined;
	const { key, offset, length } = value;
	return typeof key === "string"
		&& Number.isSafeInteger(offset) && (offset as number) >= 0
		&& Number.isSafeInteger(length) && (length as number) >= 0
		&& (offset as number) + (length as number) <= payloadLength
		? { key, offset: offset as number, length: length as number }
		: undefined;
}

function parseSkipped(value: unknown): { key: string; reason: string } | undefined {
	return isRecord(value) && typeof value["key"] === "string" && typeof value["reason"] === "string"
		? { key: value["key"], reason: value["reason"] }
		: undefined;
}

function baselineFromManifest(manifest: RepositoryManifest): RepositoryStateBaseline {
	return { generation: manifest.generation, entries: manifest.entries.map(({ key, hash }) => ({ key, hash })) };
}

function emptySummary(): RepositoryStateSummary {
	return { baseline: { generation: "root", entries: [] }, restored: [], skipped: [], conflicts: [] };
}

function hashBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isFileExistsError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
