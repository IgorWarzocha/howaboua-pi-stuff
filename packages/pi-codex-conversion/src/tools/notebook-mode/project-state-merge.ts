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

export function mergeProjectState(options: {
	baseline: ProjectStateBaseline;
	current?: ProjectStateManifest | undefined;
	candidate: ProjectStateCandidate;
	candidatePayload: Buffer;
	currentPayload: Buffer;
}): ProjectStateMerge {
	const base = new Map(options.baseline.entries.map(({ name, hash }) => [name, hash]));
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
	let candidateChangedAny = false;
	const capturedAt = new Date().toISOString();
	for (const name of names) {
		const baseHash = base.get(name);
		const currentEntry = current.get(name);
		const candidateEntry = candidate.get(name);
		const candidateHash = skipped.has(name) ? baseHash : candidateEntry?.hash;
		const currentHash = currentEntry?.hash;
		const candidateChanged = !skipped.has(name) && candidateHash !== baseHash;
		const currentChanged = currentHash !== baseHash;
		candidateChangedAny ||= candidateChanged;
		let selected: { entry: ProjectStateEntry; payload: Buffer } | undefined;
		if (candidateChanged && !candidateEntry && currentEntry?.pinned) {
			conflicts.push(name);
			selected = { entry: currentEntry, payload: options.currentPayload };
		} else if (candidateChanged && currentChanged && candidateHash !== currentHash) {
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
					updatedAt: candidateHash === currentHash
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
	const currentShape = JSON.stringify((options.current?.entries ?? []).map(({ name, kind, hash }) => [name, kind, hash]));
	const mergedShape = JSON.stringify(entries.map(({ name, kind, hash }) => [name, kind, hash]));
	const skippedBaseline = options.baseline.entries.filter(({ name }) => skipped.has(name));
	return {
		changed: candidateChangedAny && mergedShape !== currentShape,
		baseline: {
			generation: options.baseline.generation,
			entries: [
				...skippedBaseline,
				...[...candidate.values()].map(({ name, hash }) => ({ name, hash })),
			].sort((left, right) => left.name.localeCompare(right.name)),
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
