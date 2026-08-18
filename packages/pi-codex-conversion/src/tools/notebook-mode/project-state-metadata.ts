import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type ProjectStateEntry,
	projectStatePaths,
	readProjectStateManifest,
} from "./project-state-format.ts";

export interface RetainedProjectBinding {
	name: string;
	kind: ProjectStateEntry["kind"];
	bytes: number;
	updatedAt: string;
	pinned: boolean;
	description?: string | undefined;
	usage?: string | undefined;
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
		...(entry.description === undefined ? {} : { description: entry.description }),
		...(entry.usage === undefined ? {} : { usage: entry.usage }),
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
