import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	MAX_PROJECT_MANIFEST_BYTES,
	type ProjectStateEntry,
	projectStatePaths,
	readProjectStateManifest,
	readProjectStatePayload,
} from "./project-state-format.ts";
import { withProjectStateLock } from "./project-state-lock.ts";

export interface RetainedProjectBinding {
	name: string;
	kind: ProjectStateEntry["kind"];
	bytes: number;
	updatedAt: string;
	pinned: boolean;
}

export function readRetainedProjectBindings(
	identity: {
		project: string;
		agentDir: string;
	},
	maxBytes: number,
): RetainedProjectBinding[] {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	const manifest = readProjectStateManifest(paths.manifest);
	if (!manifest || manifest.project !== resolve(identity.project)) return [];
	if (!hasPayloadLayout(manifest.entries, join(paths.directory, manifest.payload), maxBytes)) return [];
	return manifest.entries.map((entry) => ({
		name: entry.name,
		kind: entry.kind,
		bytes: entry.length,
		updatedAt: entry.updatedAt ?? manifest.createdAt,
		pinned: entry.pinned === true,
	}));
}

function hasPayloadLayout(entries: ProjectStateEntry[], path: string, maxBytes: number): boolean {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return false;
		let offset = 0;
		const names = new Set<string>();
		for (const entry of entries) {
			if (names.has(entry.name) || entry.offset !== offset) return false;
			names.add(entry.name);
			offset += entry.length;
		}
		return offset === stat.size;
	} catch {
		return false;
	}
}

export async function setProjectBindingPins(
	identity: {
		project: string;
		agentDir: string;
	},
	maxBytes: number,
	names: string[],
	pinned: boolean,
): Promise<RetainedProjectBinding[]> {
	const paths = projectStatePaths(identity.project, identity.agentDir);
	mkdirSync(paths.directory, { recursive: true });
	await withProjectStateLock(paths.lock, async () => {
		const manifest = readProjectStateManifest(paths.manifest);
		if (!manifest || manifest.project !== resolve(identity.project)) {
			throw new Error(
				"Project notebook has no durable bindings; checkpoint it first",
			);
		}
		if (
			!readProjectStatePayload(
				manifest,
				join(paths.directory, manifest.payload),
				maxBytes,
			)
		) {
			throw new Error(
				"Project notebook payload is invalid; pins were not changed",
			);
		}
		const available = new Set(manifest.entries.map(({ name }) => name));
		const missing = names.filter((name) => !available.has(name));
		if (missing.length > 0)
			throw new Error(
				`Durable notebook bindings not found: ${missing.slice(0, 24).join(", ")}${missing.length > 24 ? `, and ${missing.length - 24} more` : ""}`,
			);
		const selected = new Set(names);
		manifest.entries = manifest.entries.map((entry) =>
			selected.has(entry.name)
				? {
						...entry,
						...(pinned ? { pinned: true as const } : { pinned: undefined }),
					}
				: entry,
		);
		const text = `${JSON.stringify(manifest, null, 2)}\n`;
		if (Buffer.byteLength(text) > MAX_PROJECT_MANIFEST_BYTES) {
			throw new Error(
				`Project manifest exceeds ${MAX_PROJECT_MANIFEST_BYTES} bytes`,
			);
		}
		const temporary = `${paths.manifest}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, text, { mode: 0o600 });
			renameSync(temporary, paths.manifest);
		} finally {
			rmSync(temporary, { force: true });
		}
	});
	return readRetainedProjectBindings(identity, maxBytes);
}
