export const SUBDIR_CONTEXT_DETAILS_KEY = "subdirContextAutoload";

export type PersistedContextFile = { path: string; content: string };

export type PersistedContextDetails = {
	files: PersistedContextFile[];
};

export function parsePersistedContextDetails(
	details: unknown,
): PersistedContextDetails | null {
	if (!details || typeof details !== "object" || Array.isArray(details))
		return null;
	const value = (details as Record<string, unknown>)[
		SUBDIR_CONTEXT_DETAILS_KEY
	];
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const files = (value as Record<string, unknown>)["files"];
	if (!Array.isArray(files)) return null;
	const parsed = files
		.filter((item): item is PersistedContextFile => {
			if (!item || typeof item !== "object" || Array.isArray(item))
				return false;
			const pathValue = (item as Record<string, unknown>)["path"];
			const contentValue = (item as Record<string, unknown>)["content"];
			return typeof pathValue === "string" && typeof contentValue === "string";
		})
		.map((item) => ({ path: item["path"], content: item["content"] }));
	if (!parsed.length) return null;
	return { files: parsed };
}

export function mergePersistedContextDetails(
	baseDetails: unknown,
	injected: PersistedContextDetails,
): Record<string, unknown> {
	if (
		baseDetails &&
		typeof baseDetails === "object" &&
		!Array.isArray(baseDetails)
	) {
		return {
			...(baseDetails as Record<string, unknown>),
			[SUBDIR_CONTEXT_DETAILS_KEY]: injected,
		};
	}
	return { [SUBDIR_CONTEXT_DETAILS_KEY]: injected };
}
