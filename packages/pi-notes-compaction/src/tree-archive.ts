import type {
	BranchSummaryEntry,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { windowDetails } from "./windows.js";

export const TREE_ARCHIVE_ENTRY_TYPE = "codex-context-tree-archive";
const TREE_ARCHIVE_PROTOCOL = 1;
export const MAX_ARCHIVE_DEPTH = 50_000;

export interface TreeArchiveManifestData {
	protocol: 1;
	strategy: "codex-context-tree";
	windowId: string;
	boundaryEntryId: string;
	summaryEntryId: string;
	archivedLeafId: string;
	branchBaseId: string | null;
	compactionEntryId?: string;
}

interface TreeArchive {
	manifest: TreeArchiveManifestData;
	summary: BranchSummaryEntry;
	// Pi forks copy the active branch, not the archived paths it references.
	entries: SessionEntry[] | undefined;
}

export interface TreeArchiveIndex {
	archives: TreeArchive[];
	invalidManifest: boolean;
}

export function buildTreeArchiveIndex(
	allEntries: readonly SessionEntry[],
	activeBranch: readonly SessionEntry[],
): TreeArchiveIndex {
	const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
	const archives: TreeArchive[] = [];
	const seenSummaries = new Set<string>();
	const seenWindows = new Set<string>();
	let invalidManifest = false;
	for (const entry of activeBranch) {
		if (entry.type !== "custom" || entry.customType !== TREE_ARCHIVE_ENTRY_TYPE)
			continue;
		if (!isTreeArchiveManifestData(entry.data)) {
			invalidManifest = true;
			continue;
		}
		const manifest = entry.data;
		if (
			seenSummaries.has(manifest.summaryEntryId) ||
			seenWindows.has(manifest.windowId)
		) {
			invalidManifest = true;
			continue;
		}
		const summary = byId.get(manifest.summaryEntryId);
		if (
			!summary ||
			summary.type !== "branch_summary" ||
			entry.parentId !== summary.id ||
			summary.fromId !== manifest.archivedLeafId ||
			summary.parentId !== manifest.branchBaseId
		) {
			invalidManifest = true;
			continue;
		}
		const archivedEntries = archivedPath(manifest, byId);
		if (
			archivedEntries &&
			manifest.compactionEntryId !== undefined &&
			!archivedEntries.some(
				(entry) =>
					entry.id === manifest.compactionEntryId &&
					entry.type === "compaction",
			)
		) {
			invalidManifest = true;
			continue;
		}
		seenSummaries.add(summary.id);
		seenWindows.add(manifest.windowId);
		archives.push({ manifest, summary, entries: archivedEntries });
	}
	return { archives, invalidManifest };
}

function archivedPath(
	manifest: TreeArchiveManifestData,
	byId: ReadonlyMap<string, SessionEntry>,
): SessionEntry[] | undefined {
	const reverse: SessionEntry[] = [];
	const visited = new Set<string>();
	let currentId: string | null = manifest.archivedLeafId;
	let foundBoundary = false;
	while (currentId !== manifest.branchBaseId) {
		if (
			currentId === null ||
			visited.has(currentId) ||
			reverse.length >= MAX_ARCHIVE_DEPTH
		)
			return undefined;
		visited.add(currentId);
		const entry = byId.get(currentId);
		if (!entry) return undefined;
		reverse.push(entry);
		if (entry.id === manifest.boundaryEntryId) foundBoundary = true;
		currentId = entry.parentId;
	}
	if (!foundBoundary) return undefined;
	return reverse.reverse();
}

export function isTreeArchiveManifestData(
	value: unknown,
): value is TreeArchiveManifestData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const manifest = value as Record<string, unknown>;
	return (
		manifest["protocol"] === TREE_ARCHIVE_PROTOCOL &&
		manifest["strategy"] === "codex-context-tree" &&
		nonEmptyString(manifest["windowId"]) &&
		nonEmptyString(manifest["boundaryEntryId"]) &&
		nonEmptyString(manifest["summaryEntryId"]) &&
		nonEmptyString(manifest["archivedLeafId"]) &&
		(manifest["compactionEntryId"] === undefined ||
			nonEmptyString(manifest["compactionEntryId"])) &&
		(manifest["branchBaseId"] === null ||
			nonEmptyString(manifest["branchBaseId"]))
	);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

export function hasTreeArchiveSuccessor(
	entries: readonly SessionEntry[],
	windowId: string,
): boolean {
	return entries.some((entry) => {
		const details = windowDetails(entry);
		return (
			details?.kind === "window" &&
			details.identity.previousWindowId === windowId
		);
	});
}
