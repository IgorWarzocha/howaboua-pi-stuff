import {
	hashStateBytes,
	MAX_PROJECT_ENTRIES,
	type ProjectStateBaseline,
	type ProjectStateCandidate,
	type ProjectStateEntry,
	type ProjectStateManifest,
} from "./project-state-format.ts";

export interface ProjectStateMerge {
	changed: boolean;
	baseline: ProjectStateBaseline;
	entries: ProjectStateEntry[];
	payload: Buffer;
	conflicts: string[];
	appliedNames: string[];
	conflictEntries: ProjectStateEntry[];
	conflictDeletions: string[];
	conflictPayload: Buffer;
}

export interface ProjectStatePinUpdate {
	names: readonly string[];
	pinned: boolean;
}

export function mergeProjectState(options: {
	baseline: ProjectStateBaseline;
	current?: ProjectStateManifest | undefined;
	candidate: ProjectStateCandidate;
	candidatePayload: Buffer;
	currentPayload: Buffer;
	pins?: ProjectStatePinUpdate | undefined;
}): ProjectStateMerge {
	const base = new Map(options.baseline.entries.map((entry) => [entry.name, entry]));
	const current = new Map((options.current?.entries ?? []).map((entry) => [entry.name, entry]));
	const candidate = new Map(options.candidate.entries.map((entry) => [entry.name, {
		...entry,
		hash: hashStateBytes(options.candidatePayload.subarray(entry.offset, entry.offset + entry.length)),
	}]));
	const skipped = new Set(options.candidate.skipped.map(({ name }) => name));
	const names = [...new Set([...base.keys(), ...current.keys(), ...candidate.keys(), ...skipped])].sort();
	if (names.length > MAX_PROJECT_ENTRIES) throw new Error(`Project notebook state exceeds ${MAX_PROJECT_ENTRIES} top-level values`);
	const parts: Buffer[] = [];
	const entries: ProjectStateEntry[] = [];
	const conflictParts: Buffer[] = [];
	const conflictEntries: ProjectStateEntry[] = [];
	const conflictDeletions: string[] = [];
	const conflicts: string[] = [];
	const appliedNames: string[] = [];
	let offset = 0;
	let conflictOffset = 0;
	const capturedAt = new Date().toISOString();
	for (const name of names) {
		const baseEntry = base.get(name);
		const currentEntry = current.get(name);
		const candidateEntry = candidate.get(name);
		const baseFingerprint = projectStateEntryFingerprint(baseEntry);
		const candidateFingerprint = skipped.has(name) ? baseFingerprint : projectStateEntryFingerprint(candidateEntry);
		const currentFingerprint = projectStateEntryFingerprint(currentEntry);
		const candidateChanged = !skipped.has(name) && candidateFingerprint !== baseFingerprint;
		const currentChanged = currentFingerprint !== baseFingerprint;
		let selected: { entry: ProjectStateEntry; payload: Buffer } | undefined;
		if (candidateChanged && !candidateEntry && currentEntry?.pinned) {
			conflicts.push(name);
			selected = { entry: currentEntry, payload: options.currentPayload };
		} else if (candidateChanged && currentChanged && candidateFingerprint !== currentFingerprint) {
			conflicts.push(name);
			if (candidateEntry) {
				const bytes = options.candidatePayload.subarray(candidateEntry.offset, candidateEntry.offset + candidateEntry.length);
				conflictParts.push(bytes);
				conflictEntries.push({ ...candidateEntry, offset: conflictOffset });
				conflictOffset += bytes.length;
			} else conflictDeletions.push(name);
			if (currentEntry) selected = { entry: currentEntry, payload: options.currentPayload };
		} else if (candidateChanged) {
			appliedNames.push(name);
			if (candidateEntry) selected = {
				entry: {
					...candidateEntry,
					updatedAt: candidateFingerprint === currentFingerprint
						? currentEntry?.updatedAt ?? options.current?.createdAt ?? capturedAt
						: capturedAt,
					...(currentEntry?.pinned ? { pinned: true } : {}),
				},
				payload: options.candidatePayload,
			};
		} else if (currentEntry) {
			selected = { entry: currentEntry, payload: options.currentPayload };
		}
		if (!selected) continue;
		const bytes = selected.payload.subarray(selected.entry.offset, selected.entry.offset + selected.entry.length);
		parts.push(bytes);
		entries.push({
			...selected.entry,
			updatedAt: selected.entry.updatedAt
				?? (selected.payload === options.currentPayload ? options.current?.createdAt : undefined)
				?? capturedAt,
			offset,
		});
		offset += bytes.length;
	}
	if (options.pins) {
		const selected = new Set(options.pins.names);
		const available = new Set(entries.map(({ name }) => name));
		const missing = options.pins.names.filter((name) => !available.has(name));
		if (missing.length > 0) throw new Error(`Durable notebook bindings not found: ${missing.join(", ")}`);
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]!;
			if (!selected.has(entry.name)) continue;
			entries[index] = {
				...entry,
				...(options.pins.pinned ? { pinned: true } : { pinned: undefined }),
			};
		}
	}
	const currentShape = JSON.stringify((options.current?.entries ?? []).map(projectStateEntryShape));
	const mergedShape = JSON.stringify(entries.map(projectStateEntryShape));
	const skippedBaseline = options.baseline.entries.filter(({ name }) => skipped.has(name));
	return {
		changed: mergedShape !== currentShape,
		baseline: {
			generation: options.baseline.generation,
			entries: [...skippedBaseline, ...[...candidate.values()].map(({ name, hash, description, usage }) => ({
				name,
				hash,
				...(description === undefined ? {} : { description }),
				...(usage === undefined ? {} : { usage }),
			}))].sort((left, right) => left.name.localeCompare(right.name)),
		},
		entries,
		payload: Buffer.concat(parts),
		conflicts,
		appliedNames,
		conflictEntries,
		conflictDeletions,
		conflictPayload: Buffer.concat(conflictParts),
	};
}

export function projectStateEntryFingerprint(entry: {
	hash?: string | undefined;
	description?: string | undefined;
	usage?: string | undefined;
} | undefined): string | undefined {
	return entry === undefined
		? undefined
		: JSON.stringify([entry.hash ?? null, entry.description ?? null, entry.usage ?? null]);
}

function projectStateEntryShape(entry: ProjectStateEntry): [string, string, string, boolean, string | null, string | null] {
	return [entry.name, entry.kind, entry.hash, entry.pinned === true, entry.description ?? null, entry.usage ?? null];
}
