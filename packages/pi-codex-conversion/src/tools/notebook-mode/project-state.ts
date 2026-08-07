import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { acquireDirectoryLock } from "./directory-lock.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import {
	baselineFromProjectManifest,
	emptyProjectStateSummary,
	MAX_PROJECT_ENTRIES,
	MAX_PROJECT_MANIFEST_BYTES,
	MAX_PROJECT_NAME_BYTES,
	PROJECT_STATE_SCHEMA,
	projectStatePaths,
	readProjectStateCandidate,
	readProjectStateManifest,
	readProjectStatePayload,
	type ProjectStateBaseline,
	type ProjectStateCandidate,
	type ProjectStateManifest,
	type ProjectStateSummary,
} from "./project-state-format.ts";
import { mergeProjectState, type ProjectStateMerge } from "./project-state-merge.ts";
import { projectStateCaptureSource, projectStateRestoreSource } from "./project-state-runtime.ts";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 5_000;
const MAX_NOTICE_NAMES = 24;

export type { ProjectStateBaseline, ProjectStateSummary } from "./project-state-format.ts";

export async function restoreProjectState(
	kernel: DenoJupyterKernel,
	identity: { project: string; agentDir: string; maxBytes: number },
): Promise<ProjectStateSummary> {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	const manifest = readProjectStateManifest(paths.manifest);
	if (!manifest) return emptyProjectStateSummary();
	if (manifest.project !== resolve(identity.project)) {
		return { ...emptyProjectStateSummary(), message: "Project notebook identity was incompatible and was not restored" };
	}
	const payloadPath = join(paths.directory, manifest.payload);
	if (!readProjectStatePayload(manifest, payloadPath, identity.maxBytes)) {
		return { ...emptyProjectStateSummary(), message: "Project notebook payload was missing or invalid and was not restored" };
	}
	const result = await kernel.execute(projectStateRestoreSource(manifest, payloadPath));
	if (result.status !== "ok") {
		return {
			...emptyProjectStateSummary(),
			message: `Project notebook was incompatible and was not restored: ${result.errorText ?? "unknown error"}`,
		};
	}
	return {
		baseline: baselineFromProjectManifest(manifest),
		restored: manifest.entries,
		skipped: manifest.skipped,
		conflicts: listProjectConflicts(paths.directory),
	};
}

export async function writeProjectState(
	kernel: DenoJupyterKernel,
	identity: { project: string; session: string; agentDir: string },
	baseline: ProjectStateBaseline,
	baselineNames: ReadonlySet<string>,
	maxBytes: number,
): Promise<ProjectStateSummary> {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	mkdirSync(paths.directory, { recursive: true });
	const candidateId = randomUUID();
	const candidatePayloadPath = join(paths.directory, `candidate-${candidateId}.bin`);
	const candidateManifestPath = join(paths.directory, `candidate-${candidateId}.json`);
	try {
		const names = [...new Set(await kernel.complete("", 0))]
			.filter((name) => !baselineNames.has(name) && IDENTIFIER.test(name))
			.sort();
		if (names.length > MAX_PROJECT_ENTRIES) throw new Error(`Project notebook state exceeds ${MAX_PROJECT_ENTRIES} top-level values`);
		if (names.some((name) => Buffer.byteLength(name) > MAX_PROJECT_NAME_BYTES)) {
			throw new Error(`Project notebook name exceeds ${MAX_PROJECT_NAME_BYTES} bytes`);
		}
		const capture = await kernel.execute(projectStateCaptureSource({
			candidates: names,
			payloadPath: candidatePayloadPath,
			manifestPath: candidateManifestPath,
			maxBytes,
		}));
		if (capture.status !== "ok") throw new Error(`Project notebook checkpoint failed: ${capture.errorText ?? "unknown error"}`);
		const candidate = readProjectStateCandidate(candidateManifestPath, candidatePayloadPath, maxBytes);
		if (!candidate) throw new Error("Project notebook checkpoint did not produce a valid candidate");
		const candidatePayload = readFileSync(candidatePayloadPath);
		const committed = await withProjectLock(paths.lock, async () => commitCandidate({
			paths,
			identity,
			baseline,
			candidate,
			candidatePayload,
			maxBytes,
		}));
		if (!committed.manifest) return { ...emptyProjectStateSummary(), skipped: candidate.skipped, conflicts: committed.conflicts };
		if (committed.rebind) {
			const clearNames = [...new Set([...baseline.entries.map(({ name }) => name), ...candidate.entries.map(({ name }) => name)])];
			const restore = await kernel.execute(projectStateRestoreSource(
				committed.manifest,
				join(paths.directory, committed.manifest.payload),
				clearNames,
			));
			if (restore.status !== "ok") throw new Error(`Committed project notebook could not be rebound: ${restore.errorText ?? "unknown error"}`);
		}
		return {
			baseline: baselineFromProjectManifest(committed.manifest),
			restored: committed.manifest.entries,
			skipped: candidate.skipped,
			conflicts: committed.conflicts,
		};
	} finally {
		rmSync(candidatePayloadPath, { force: true });
		rmSync(candidateManifestPath, { force: true });
	}
}

export function formatProjectStateNotice(summary: ProjectStateSummary): string | undefined {
	if (summary.message) return summary.message;
	const values = summary.restored.filter(({ kind }) => kind === "value").length;
	const definitions = summary.restored.length - values;
	const restored = summary.restored.length > 0
		? `Project notebook restored ${values} value${values === 1 ? "" : "s"} and ${definitions} definition${definitions === 1 ? "" : "s"}`
		: undefined;
	const conflicts = summary.conflicts.length > 0
		? `Project notebook conflicts preserved without overwrite: ${formatNameList(summary.conflicts)}`
		: undefined;
	return [restored, conflicts].filter(Boolean).join(". ") || undefined;
}

async function commitCandidate(options: {
	paths: ReturnType<typeof projectStatePaths>;
	identity: { project: string; session: string };
	baseline: ProjectStateBaseline;
	candidate: ProjectStateCandidate;
	candidatePayload: Buffer;
	maxBytes: number;
}): Promise<{ manifest?: ProjectStateManifest | undefined; conflicts: string[]; rebind: boolean }> {
	const current = readProjectStateManifest(options.paths.manifest);
	if (current && (current.deno !== options.candidate.deno || current.v8 !== options.candidate.v8)) {
		throw new Error("Project notebook uses an incompatible Deno/V8 version; the existing state was preserved");
	}
	const currentPayload = current
		? readProjectStatePayload(current, join(options.paths.directory, current.payload), options.maxBytes)
		: Buffer.alloc(0);
	if (!currentPayload) throw new Error("Existing project notebook payload is invalid; it was preserved without overwrite");
	const merged = mergeProjectState({
		baseline: options.baseline,
		...(current ? { current } : {}),
		candidate: options.candidate,
		candidatePayload: options.candidatePayload,
		currentPayload,
	});
	if (merged.payload.length > options.maxBytes) throw new Error("Merged project notebook exceeds the checkpoint cap");
	if (merged.conflicts.length > 0) writeProjectConflict(options.paths.directory, options.identity, merged);
	const manifest = merged.changed
		? writeMergedProjectState(options.paths, options.identity, current, options.candidate, merged)
		: current;
	removeResolvedProjectConflicts(options.paths.directory, new Set(merged.appliedNames));
	return {
		...(manifest ? { manifest } : {}),
		conflicts: merged.conflicts,
		rebind: Boolean(current && current.generation !== options.baseline.generation) || merged.conflicts.length > 0,
	};
}

function writeMergedProjectState(
	paths: ReturnType<typeof projectStatePaths>,
	identity: { project: string; session: string },
	current: ProjectStateManifest | undefined,
	candidate: ProjectStateCandidate,
	merged: ProjectStateMerge,
): ProjectStateManifest {
	const generation = randomUUID();
	const payload = `project-${generation}.bin`;
	const manifest: ProjectStateManifest = {
		schema: PROJECT_STATE_SCHEMA,
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
	const text = `${JSON.stringify(manifest, null, 2)}\n`;
	if (Buffer.byteLength(text) > MAX_PROJECT_MANIFEST_BYTES) throw new Error(`Project manifest exceeds ${MAX_PROJECT_MANIFEST_BYTES} bytes`);
	writeFileSync(join(paths.directory, payload), merged.payload, { mode: 0o600 });
	const temporary = `${paths.manifest}.${randomUUID()}.tmp`;
	writeFileSync(temporary, text, { mode: 0o600 });
	renameSync(temporary, paths.manifest);
	if (current?.payload && current.payload !== payload) rmSync(join(paths.directory, current.payload), { force: true });
	return manifest;
}

async function withProjectLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
	const lock = await acquireDirectoryLock(path, { waitMs: LOCK_WAIT_MS, staleMs: LOCK_STALE_MS, pollMs: 50 });
	if (!lock) throw new Error("Project notebook checkpoint lock became unavailable");
	try {
		return await operation();
	} finally {
		lock.release();
	}
}

function writeProjectConflict(
	directory: string,
	identity: { project: string; session: string },
	merged: ProjectStateMerge,
): void {
	const conflicts = join(directory, "conflicts");
	mkdirSync(conflicts, { recursive: true });
	for (const entry of merged.conflictEntries) {
		const id = `${Date.now()}-${randomUUID()}`;
		const payload = `${id}.bin`;
		const bytes = merged.conflictPayload.subarray(entry.offset, entry.offset + entry.length);
		writeFileSync(join(conflicts, payload), bytes, { mode: 0o600 });
		writeFileSync(join(conflicts, `${id}.json`), `${JSON.stringify({
			schema: PROJECT_STATE_SCHEMA,
			project: resolve(identity.project),
			session: identity.session,
			createdAt: new Date().toISOString(),
			payload,
			entries: [{ ...entry, offset: 0 }],
			deletions: [],
		}, null, 2)}\n`, { mode: 0o600 });
	}
	for (const name of merged.conflictDeletions) {
		const id = `${Date.now()}-${randomUUID()}`;
		writeFileSync(join(conflicts, `${id}.json`), `${JSON.stringify({
			schema: PROJECT_STATE_SCHEMA,
			project: resolve(identity.project),
			session: identity.session,
			createdAt: new Date().toISOString(),
			entries: [],
			deletions: [name],
		}, null, 2)}\n`, { mode: 0o600 });
	}
}

function listProjectConflicts(directory: string): string[] {
	const names = new Set<string>();
	for (const file of readDirectoryNames(join(directory, "conflicts"))) {
		if (!file.endsWith(".json")) continue;
		try {
			const value = JSON.parse(readFileSync(join(directory, "conflicts", file), "utf8")) as Record<string, unknown>;
			for (const entry of Array.isArray(value["entries"]) ? value["entries"] : []) {
				if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>)["name"] === "string") names.add((entry as Record<string, string>)["name"]!);
			}
			for (const name of Array.isArray(value["deletions"]) ? value["deletions"] : []) if (typeof name === "string") names.add(name);
		} catch {}
	}
	return [...names].sort();
}

function removeResolvedProjectConflicts(directory: string, names: ReadonlySet<string>): void {
	if (names.size === 0) return;
	const conflicts = join(directory, "conflicts");
	for (const file of readDirectoryNames(conflicts)) {
		if (!file.endsWith(".json")) continue;
		const path = join(conflicts, file);
		try {
			const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
			const conflictNames = [
				...(Array.isArray(value["entries"]) ? value["entries"].flatMap((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>)["name"] === "string" ? [(entry as Record<string, string>)["name"]!] : []) : []),
				...(Array.isArray(value["deletions"]) ? value["deletions"].filter((name): name is string => typeof name === "string") : []),
			];
			if (!conflictNames.some((name) => names.has(name))) continue;
			if (typeof value["payload"] === "string") rmSync(join(conflicts, value["payload"]), { force: true });
			rmSync(path, { force: true });
		} catch {}
	}
}

function readDirectoryNames(directory: string): string[] {
	if (!existsSync(directory)) return [];
	try {
		return readdirSync(directory);
	} catch {
		return [];
	}
}

function formatNameList(names: string[]): string {
	const shown = names.slice(0, MAX_NOTICE_NAMES).join(", ");
	return names.length > MAX_NOTICE_NAMES ? `${shown}, and ${names.length - MAX_NOTICE_NAMES} more` : shown;
}
