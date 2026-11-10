/** @typedef {import("./tree-archive.js").TreeArchiveManifestData} TreeArchiveManifestData */
export const TREE_ARCHIVE_ENTRY_TYPE = "codex-context-tree-archive";
const TREE_ARCHIVE_PROTOCOL = 1;
export const MAX_ARCHIVE_DEPTH = 50_000;

/** @param {unknown} value @returns {value is TreeArchiveManifestData} */
export function isTreeArchiveManifestData(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const manifest = /** @type {Record<string, unknown>} */ (value);
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

/** @param {unknown} value @returns {value is string} */
function nonEmptyString(value) {
	return typeof value === "string" && value !== "";
}
