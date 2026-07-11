export const EXTENSION_ID = "openai-native-compaction";
export const NATIVE_COMPACTION_STRATEGY = "openai-native-compact-v1";
export const NATIVE_COMPACTION_SHIM_SUMMARY = "[OpenAI native compaction checkpoint]";
export const NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE = "codex-native-compaction-display";
export const NATIVE_COMPACTION_DISPLAY_TEXT = [
    "Codex native compaction was used for this checkpoint.",
    "",
    "The compaction result is encrypted by OpenAI and is not human-readable in Pi.",
    "",
    "Warning: do not turn Responses compaction off or switch providers mid-session; old context may be much less reliable.",
].join("\n");
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isFiniteNonNegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function normalizeString(value) {
    return value.trim();
}
function isStructuredValue(value) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isStructuredValue);
    }
    if (isRecord(value)) {
        return Object.values(value).every(isStructuredValue);
    }
    return false;
}
function cloneStructuredValue(value) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(cloneStructuredValue);
    }
    if (isRecord(value)) {
        const clone = {};
        for (const [key, nested] of Object.entries(value)) {
            clone[key] = cloneStructuredValue(nested);
        }
        return clone;
    }
    throw new Error(`Unsupported structured value: ${typeof value}`);
}
function isCompactedWindowItem(value) {
    return isRecord(value) && Object.values(value).every(isStructuredValue);
}
export function isNativeCompactionRequestMeta(value) {
    if (!isRecord(value)) {
        return false;
    }
    const { tokensBefore, previousSummaryPresent, compactedKeptWindow } = value;
    if (tokensBefore !== undefined && !isFiniteNonNegativeNumber(tokensBefore)) {
        return false;
    }
    if (previousSummaryPresent !== undefined && typeof previousSummaryPresent !== "boolean") {
        return false;
    }
    if (compactedKeptWindow !== undefined && typeof compactedKeptWindow !== "boolean") {
        return false;
    }
    return true;
}
export function isNativeCompactionIdentity(value) {
    if (!isRecord(value)) {
        return false;
    }
    return (isNonEmptyString(value["provider"]) &&
        isNonEmptyString(value["api"]) &&
        isNonEmptyString(value["model"]) &&
        isNonEmptyString(value["baseUrl"]));
}
export function isNativeCompactionDetails(value) {
    if (!isRecord(value)) {
        return false;
    }
    const candidate = value;
    return (candidate["strategy"] === NATIVE_COMPACTION_STRATEGY &&
        isNonEmptyString(candidate["provider"]) &&
        isNonEmptyString(candidate["api"]) &&
        isNonEmptyString(candidate["model"]) &&
        isNonEmptyString(candidate["baseUrl"]) &&
        Array.isArray(candidate["compactedWindow"]) &&
        candidate["compactedWindow"].every(isCompactedWindowItem) &&
        isNonEmptyString(candidate["createdAt"]) &&
        (candidate["compactResponseId"] === undefined || isNonEmptyString(candidate["compactResponseId"])) &&
        (candidate["requestMeta"] === undefined || isNativeCompactionRequestMeta(candidate["requestMeta"])));
}
export function isNativeCompactionEntry(value) {
    return isRecord(value) && value["type"] === "compaction" && isNativeCompactionDetails(value["details"]);
}
export function isNativeCompactionShimSummary(value) {
    return value === NATIVE_COMPACTION_SHIM_SUMMARY;
}
export function createNativeCompactionDetails(input) {
    return {
        strategy: NATIVE_COMPACTION_STRATEGY,
        provider: normalizeString(input.provider),
        api: normalizeString(input.api),
        model: normalizeString(input.model),
        baseUrl: normalizeString(input.baseUrl),
        compactedWindow: input.compactedWindow.map((item) => cloneStructuredValue(item)),
        compactResponseId: isNonEmptyString(input.compactResponseId) ? normalizeString(input.compactResponseId) : undefined,
        createdAt: isNonEmptyString(input.createdAt) ? normalizeString(input.createdAt) : new Date().toISOString(),
        requestMeta: input.requestMeta
            ? {
                ...(input.requestMeta.tokensBefore !== undefined ? { tokensBefore: input.requestMeta.tokensBefore } : {}),
                ...(input.requestMeta.previousSummaryPresent !== undefined
                    ? { previousSummaryPresent: input.requestMeta.previousSummaryPresent }
                    : {}),
                ...(input.requestMeta.compactedKeptWindow !== undefined
                    ? { compactedKeptWindow: input.requestMeta.compactedKeptWindow }
                    : {}),
            }
            : undefined,
    };
}
export function createNativeCompactionShimSummary() {
    return NATIVE_COMPACTION_SHIM_SUMMARY;
}
export function createNativeCompactionShimResult(input) {
    return {
        summary: input.summary,
        firstKeptEntryId: input.firstKeptEntryId,
        tokensBefore: input.tokensBefore,
        details: input.details,
    };
}
