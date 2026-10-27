import type {
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

export interface ContextFamilyBindingOptions {
	/** Caller asserts entries through this boundary were inherited by a new native fork, before child work. */
	fork?: { lastInheritedEntryId: string };
}

/** Classify only child-owned startup records, without modifying inherited history. */
export function bindingStartupEntries(
	ctx: ExtensionContext,
	options?: ContextFamilyBindingOptions,
): SessionEntry[] {
	const entries = ctx.sessionManager.getEntries();
	if (!options?.fork) return entries;
	const id = options.fork.lastInheritedEntryId;
	const boundary = entries.findIndex((entry) => entry.id === id);
	if (
		!ctx.sessionManager.getHeader()?.parentSession ||
		typeof id !== "string" ||
		!id ||
		boundary < 0
	)
		throw new Error(
			"Fork family binding requires an inherited entry boundary in a new native fork",
		);
	return entries.slice(boundary + 1);
}
