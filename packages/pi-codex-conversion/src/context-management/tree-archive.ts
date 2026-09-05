import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	BranchSummaryEntry,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const TREE_ARCHIVE_ENTRY_TYPE = "codex-context-tree-archive";
const TREE_ARCHIVE_PROTOCOL = 1;
const MAX_ARCHIVE_DEPTH = 50_000;

export interface TreeArchiveManifestData {
	protocol: 1;
	strategy: "codex-context-tree";
	windowId: string;
	boundaryEntryId: string;
	summaryEntryId: string;
	archivedLeafId: string;
	branchBaseId: string | null;
}

export interface TreeArchive {
	manifest: TreeArchiveManifestData;
	summary: BranchSummaryEntry;
	entries: SessionEntry[];
}

export interface TreeArchiveIndex {
	archives: TreeArchive[];
	hiddenSummarySignatures: ReadonlySet<string>;
	invalidManifest: boolean;
}

export function createTreeArchiveManifest(
	windowId: string,
	boundaryEntryId: string,
	summary: BranchSummaryEntry,
): TreeArchiveManifestData {
	return {
		protocol: TREE_ARCHIVE_PROTOCOL,
		strategy: "codex-context-tree",
		windowId,
		boundaryEntryId,
		summaryEntryId: summary.id,
		archivedLeafId: summary.fromId,
		branchBaseId: summary.parentId,
	};
}

export function buildTreeArchiveIndex(
	allEntries: readonly SessionEntry[],
	activeBranch: readonly SessionEntry[],
): TreeArchiveIndex {
	const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
	const archives: TreeArchive[] = [];
	const hiddenSummarySignatures = new Set<string>();
	const seenSummaries = new Set<string>();
	const seenWindows = new Set<string>();
	let invalidManifest = false;
	for (const entry of activeBranch) {
		if (
			entry.type !== "custom" ||
			entry.customType !== TREE_ARCHIVE_ENTRY_TYPE
		)
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
		if (!archivedEntries) {
			invalidManifest = true;
			continue;
		}
		seenSummaries.add(summary.id);
		seenWindows.add(manifest.windowId);
		archives.push({ manifest, summary, entries: archivedEntries });
		hiddenSummarySignatures.add(branchSummarySignature(summary));
	}
	return { archives, hiddenSummarySignatures, invalidManifest };
}

export function filterTreeArchiveSummaries(
	messages: readonly AgentMessage[],
	index: TreeArchiveIndex,
): AgentMessage[] {
	return messages.filter(
		(message) =>
			message.role !== "branchSummary" ||
			!index.hiddenSummarySignatures.has(
				branchSummaryMessageSignature(message),
			),
	);
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

function branchSummarySignature(summary: BranchSummaryEntry): string {
	return JSON.stringify([
		summary.fromId,
		summary.summary,
		new Date(summary.timestamp).getTime(),
	]);
}

function branchSummaryMessageSignature(
	message: Extract<AgentMessage, { role: "branchSummary" }>,
): string {
	return JSON.stringify([message.fromId, message.summary, message.timestamp]);
}

function isTreeArchiveManifestData(
	value: unknown,
): value is TreeArchiveManifestData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const manifest = value as Record<string, unknown>;
	return manifest["protocol"] === TREE_ARCHIVE_PROTOCOL &&
		manifest["strategy"] === "codex-context-tree" &&
		nonEmptyString(manifest["windowId"]) &&
		nonEmptyString(manifest["boundaryEntryId"]) &&
		nonEmptyString(manifest["summaryEntryId"]) &&
		nonEmptyString(manifest["archivedLeafId"]) &&
		(manifest["branchBaseId"] === null ||
			nonEmptyString(manifest["branchBaseId"]));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}
