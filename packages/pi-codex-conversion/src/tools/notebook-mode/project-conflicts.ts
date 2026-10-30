import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROJECT_STATE_SCHEMA, readProjectConflictRecord } from "./project-state-format.ts";
import type { ProjectStateMerge } from "./project-state-merge.ts";

export function writeProjectConflict(
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

export function listProjectConflicts(directory: string): string[] {
	const names = new Set<string>();
	for (const file of readDirectoryNames(join(directory, "conflicts"))) {
		if (!file.endsWith(".json")) continue;
		const record = readProjectConflictRecord(join(directory, "conflicts", file));
		for (const name of record?.names ?? []) names.add(name);
	}
	return [...names].sort();
}

export function removeResolvedProjectConflicts(directory: string, names: ReadonlySet<string>): void {
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
