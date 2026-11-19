import { createHash } from "node:crypto";

const SUBDIR_CONTEXT_DETAILS_KEY = "subdirContextAutoload";

export type ContextFingerprint = { path: string; sha256: string };
type ContextReceipt = ContextFingerprint | { path: string; content: string };

export function fingerprint(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export function parsePersistedContextDetails(
	details: unknown,
): { files: ContextReceipt[] } | null {
	if (!details || typeof details !== "object" || Array.isArray(details))
		return null;
	const value = (details as Record<string, unknown>)[
		SUBDIR_CONTEXT_DETAILS_KEY
	];
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const files = (value as Record<string, unknown>)["files"];
	if (!Array.isArray(files)) return null;
	const parsed: ContextReceipt[] = [];
	for (const item of files as unknown[]) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const { path, sha256, content } = item as Record<string, unknown>;
		if (typeof path !== "string") continue;
		if (typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256))
			parsed.push({ path, sha256 });
		else if (typeof content === "string") parsed.push({ path, content });
	}
	if (!parsed.length) return null;
	return { files: parsed };
}

export function mergePersistedContextDetails(
	baseDetails: unknown,
	files: ContextFingerprint[],
): Record<string, unknown> {
	return {
		...(baseDetails &&
		typeof baseDetails === "object" &&
		!Array.isArray(baseDetails)
			? baseDetails
			: undefined),
		[SUBDIR_CONTEXT_DETAILS_KEY]: { files },
	};
}
