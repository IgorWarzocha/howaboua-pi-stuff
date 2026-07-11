import { isNativeCompactionDetails, isNativeCompactionEntry, } from "../compaction/types.js";
function entryMatches(entry, match) {
    const details = entry.details;
    if (!details) {
        return false;
    }
    return ((match.provider === undefined || details.provider === match.provider) &&
        (match.api === undefined || details.api === match.api) &&
        (match.model === undefined || details.model === match.model) &&
        (match.baseUrl === undefined || details.baseUrl === match.baseUrl));
}
export function getNativeCompactionDetails(entry) {
    if (!entry || entry.type !== "compaction") {
        return undefined;
    }
    return isNativeCompactionDetails(entry.details) ? entry.details : undefined;
}
export function isPersistedNativeCompactionEntry(entry) {
    return isNativeCompactionEntry(entry);
}
export function findLatestCompactionEntryIndex(entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index]?.type === "compaction") {
            return index;
        }
    }
    return undefined;
}
export function findLatestCompactionEntry(entries) {
    const index = findLatestCompactionEntryIndex(entries);
    return index === undefined ? undefined : entries[index];
}
export function findLatestNativeCompactionEntryIndex(entries, match = {}) {
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (!isPersistedNativeCompactionEntry(entry)) {
            continue;
        }
        if (!entryMatches(entry, match)) {
            continue;
        }
        return index;
    }
    return undefined;
}
export function findLatestNativeCompactionEntry(entries, match = {}) {
    const index = findLatestNativeCompactionEntryIndex(entries, match);
    return index === undefined ? undefined : entries[index];
}
export function findLatestNativeCompactionDetails(entries, match = {}) {
    return findLatestNativeCompactionEntry(entries, match)?.details;
}
export function resolveLatestNativeCompactionEntry(entries, match = {}) {
    const latestCompactionIndex = findLatestCompactionEntryIndex(entries);
    if (latestCompactionIndex === undefined) {
        return {
            ok: false,
            reason: "no-compaction",
        };
    }
    const latestCompaction = entries[latestCompactionIndex];
    if (!latestCompaction || latestCompaction.type !== "compaction" || !isPersistedNativeCompactionEntry(latestCompaction)) {
        return {
            ok: false,
            reason: "latest-compaction-not-native",
            latestCompactionIndex,
            latestCompaction: latestCompaction && latestCompaction.type === "compaction"
                ? latestCompaction
                : undefined,
        };
    }
    if (!entryMatches(latestCompaction, match)) {
        return {
            ok: false,
            reason: "latest-native-compaction-mismatch",
            latestCompactionIndex,
            latestCompaction,
        };
    }
    return {
        ok: true,
        entry: latestCompaction,
        index: latestCompactionIndex,
        latestCompactionIndex,
    };
}
