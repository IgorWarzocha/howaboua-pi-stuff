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
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import {
	baselineFromProjectManifest,
	emptyProjectStateSummary,
	MAX_PROJECT_ENTRIES,
	MAX_PROJECT_MANIFEST_BYTES,
	MAX_PROJECT_NAME_BYTES,
	PROJECT_STATE_SCHEMA,
	projectStatePaths,
	readProjectConflictRecord,
	readProjectStateCandidate,
	readProjectStateManifest,
	readProjectStatePayload,
	type ProjectStateBaseline,
	type ProjectStateCandidate,
	type ProjectStateManifest,
	type ProjectStateSummary,
} from "./project-state-format.ts";
import { mergeProjectState, type ProjectStateMerge, type ProjectStatePinUpdate } from "./project-state-merge.ts";
import { withProjectStateLock } from "./project-state-lock.ts";
import {
	parseProjectBindingNames,
	projectBindingNamesSource,
	projectStateCaptureSource,
	projectStateRestoreSource,
	promoteProjectBindingsSource,
	syncProjectBindingsSource,
} from "./project-state-runtime.ts";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_NOTICE_NAMES = 24;

export type { ProjectStateBaseline, ProjectStateSummary } from "./project-state-format.ts";

export async function restoreProjectState(
	kernel: DenoJupyterKernel,
	identity: { project: string; agentDir: string; maxBytes: number; signal?: AbortSignal | undefined },
): Promise<ProjectStateSummary> {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	mkdirSync(paths.directory, { recursive: true });
	return withProjectStateLock(paths.lock, () => restoreProjectStateLocked(kernel, identity, paths), identity.signal);
}

export function projectStateBindingNames(identity: { project: string; agentDir: string }, maxBytes: number): string[] {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	const manifest = readProjectStateManifest(paths.manifest);
	return manifest?.project === resolve(identity.project)
		&& readProjectStatePayload(manifest, join(paths.directory, manifest.payload), maxBytes)
		? manifest.entries.map(({ name }) => name)
		: [];
}

async function restoreProjectStateLocked(
	kernel: DenoJupyterKernel,
	identity: { project: string; maxBytes: number; signal?: AbortSignal | undefined },
	paths: ReturnType<typeof projectStatePaths>,
): Promise<ProjectStateSummary> {
	identity.signal?.throwIfAborted();
	const manifest = readProjectStateManifest(paths.manifest);
	if (!manifest) return emptyProjectStateSummary();
	if (manifest.project !== resolve(identity.project)) {
		return { ...emptyProjectStateSummary(), message: "Project notebook identity was incompatible and was not restored" };
	}
	const payloadPath = join(paths.directory, manifest.payload);
	if (!readProjectStatePayload(manifest, payloadPath, identity.maxBytes)) {
		return { ...emptyProjectStateSummary(), message: "Project notebook payload was missing or invalid and was not restored" };
	}
	identity.signal?.throwIfAborted();
	const result = await kernel.execute(projectStateRestoreSource(manifest, payloadPath), { signal: identity.signal });
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
	excludeNames: ReadonlySet<string> = new Set(),
	pins?: ProjectStatePinUpdate | undefined,
): Promise<ProjectStateSummary> {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	mkdirSync(paths.directory, { recursive: true });
	const candidateId = randomUUID();
	const candidatePayloadPath = join(paths.directory, `candidate-${candidateId}.bin`);
	const candidateManifestPath = join(paths.directory, `candidate-${candidateId}.json`);
	try {
		const marker = `__PI_NOTEBOOK_PROJECT_BINDINGS_${randomUUID()}__`;
		const selected = parseProjectBindingNames(await kernel.execute(projectBindingNamesSource(marker)), marker);
		const available = new Set(await kernel.complete("", 0));
		const names = selected
			.filter((name) => available.has(name) && !baselineNames.has(name) && !excludeNames.has(name) && IDENTIFIER.test(name))
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
		const committed = await withProjectStateLock(paths.lock, () => commitCandidate({
				paths,
				identity,
				baseline,
				candidate,
				candidatePayload,
				maxBytes,
				pins,
			}));
		const committedNames = [...new Set([
			...(committed.manifest?.entries.map(({ name }) => name) ?? []),
			...candidate.skipped.map(({ name }) => name),
		])];
		let syncWarning: string | undefined;
		try {
			const sync = await kernel.execute(syncProjectBindingsSource(committedNames));
			if (sync.status !== "ok") syncWarning = `Project notebook tracking could not be synchronized: ${sync.errorText ?? "unknown error"}`;
		} catch (error) {
			syncWarning = `Project notebook tracking could not be synchronized: ${error instanceof Error ? error.message : String(error)}`;
		}
		if (!committed.manifest) return { ...emptyProjectStateSummary(), skipped: candidate.skipped, conflicts: committed.conflicts };
		return {
			baseline: committed.baseline,
			restored: committed.manifest.entries,
			skipped: candidate.skipped,
			conflicts: committed.conflicts,
			...(syncWarning ? { message: syncWarning } : {}),
		};
	} finally {
		rmSync(candidatePayloadPath, { force: true });
		rmSync(candidateManifestPath, { force: true });
	}
}

export async function promoteProjectStateBindings(kernel: DenoJupyterKernel, names: string[]): Promise<void> {
	if (names.some((name) => !IDENTIFIER.test(name))) throw new Error("Project notebook binding name is invalid");
	const result = await kernel.execute(promoteProjectBindingsSource(names));
	if (result.status !== "ok") throw new Error(`Project notebook bindings could not be promoted: ${result.errorText ?? "unknown error"}`);
}

export async function projectStateBindingSelection(kernel: DenoJupyterKernel, signal?: AbortSignal): Promise<string[]> {
	const marker = `__PI_NOTEBOOK_PROJECT_BINDINGS_${randomUUID()}__`;
	return parseProjectBindingNames(
		await kernel.execute(projectBindingNamesSource(marker), { signal }),
		marker,
	);
}

export async function syncProjectStateBindings(kernel: DenoJupyterKernel, names: string[], signal?: AbortSignal): Promise<void> {
	const result = await kernel.execute(syncProjectBindingsSource(names), { signal });
	if (result.status !== "ok") throw new Error(`Project notebook tracking could not be synchronized: ${result.errorText ?? "unknown error"}`);
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
	pins?: ProjectStatePinUpdate | undefined;
}): Promise<{ manifest?: ProjectStateManifest | undefined; baseline: ProjectStateBaseline; conflicts: string[] }> {
	const current = readProjectStateManifest(options.paths.manifest);
	if (current && current.entries.length > 0 && (current.deno !== options.candidate.deno || current.v8 !== options.candidate.v8)) {
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
		pins: options.pins,
	});
	const pinConflicts = options.pins?.names.filter((name) => merged.conflicts.includes(name)) ?? [];
	if (pinConflicts.length > 0) throw new Error(`Notebook bindings changed concurrently and were not pinned: ${pinConflicts.join(", ")}`);
	if (merged.payload.length > options.maxBytes) throw new Error("Merged project notebook exceeds the checkpoint cap");
	if (merged.conflicts.length > 0) writeProjectConflict(options.paths.directory, options.identity, merged);
	const manifest = merged.changed
		? writeMergedProjectState(options.paths, options.identity, current, options.candidate, merged)
		: current;
	removeResolvedProjectConflicts(options.paths.directory, new Set(merged.appliedNames));
	return {
		...(manifest ? { manifest } : {}),
		baseline: {
			...merged.baseline,
			generation: manifest?.generation ?? merged.baseline.generation,
		},
		conflicts: merged.conflicts,
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
	if (current?.payload && current.payload !== payload) {
		try { rmSync(join(paths.directory, current.payload), { force: true }); } catch {}
	}
	return manifest;
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
		const record = readProjectConflictRecord(join(directory, "conflicts", file));
		for (const name of record?.names ?? []) names.add(name);
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
			const record = readProjectConflictRecord(path);
			if (!record || !record.names.some((name) => names.has(name))) continue;
			if (record.payload) rmSync(join(conflicts, record.payload), { force: true });
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
