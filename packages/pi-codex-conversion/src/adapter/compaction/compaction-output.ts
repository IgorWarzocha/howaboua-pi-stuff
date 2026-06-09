const COMPACTION_ITEM_TYPES = new Set(["compaction", "compaction_summary", "context_compaction"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneStructuredValue(value: unknown): unknown {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(cloneStructuredValue);
	}
	if (isRecord(value)) {
		const clone: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) {
			clone[key] = cloneStructuredValue(nested);
		}
		return clone;
	}
	throw new Error(`Unsupported structured compact output value: ${typeof value}`);
}

function cloneCompactedOutputItem(item: Record<string, unknown>): Record<string, unknown> | undefined {
	try {
		return cloneStructuredValue(item) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function shouldKeepCompactedOutputItem(item: unknown): item is Record<string, unknown> {
	return isRecord(item) && typeof item["type"]! === "string";
}

export function sanitizeCompactedWindow(output: readonly unknown[]): Record<string, unknown>[] {
	const sanitized: Record<string, unknown>[] = [];
	for (const item of output) {
		if (!shouldKeepCompactedOutputItem(item)) continue;
		const cloned = cloneCompactedOutputItem(item);
		if (cloned) sanitized.push(cloned);
	}
	return sanitized;
}

export function extractCompactionSummaryText(compactedWindow: readonly unknown[]): string | undefined {
	for (const item of compactedWindow) {
		if (!isRecord(item) || typeof item["type"]! !== "string" || !COMPACTION_ITEM_TYPES.has(item["type"]!)) continue;
		if (typeof item["encrypted_content"]! === "string" && item["encrypted_content"]!.trim().length > 0) return item["encrypted_content"]!.trim();
	}
	return undefined;
}

export function hasCompactionOutputItem(compactedWindow: readonly unknown[]): boolean {
	return compactedWindow.some((item) => isRecord(item) && typeof item["type"]! === "string" && COMPACTION_ITEM_TYPES.has(item["type"]!));
}

function describeOutputItem(item: unknown): string {
	if (!isRecord(item)) return typeof item;
	const type = typeof item["type"]! === "string" ? item["type"]! : "<missing-type>";
	const role = typeof item["role"]! === "string" ? `/${item["role"]!}` : "";
	const content = Array.isArray(item["content"]!) ? ` content=${item["content"]!.length}` : "";
	const keys = Object.keys(item).sort().slice(0, 8).join(",");
	return `${type}${role}${content} keys=[${keys}]`;
}

export function summarizeCompactionOutputForDiagnostics(rawOutput: readonly unknown[], sanitizedOutput: readonly unknown[]): string {
	const rawTypes = rawOutput.map((item) => isRecord(item) && typeof item["type"]! === "string" ? item["type"]! : typeof item);
	const sanitizedTypes = sanitizedOutput.map((item) => isRecord(item) && typeof item["type"]! === "string" ? item["type"]! : typeof item);
	const rawCounts = countValues(rawTypes);
	const sanitizedCounts = countValues(sanitizedTypes);
	const sample = rawOutput.slice(0, 8).map((item, index) => `${index}: ${describeOutputItem(item)}`).join("; ");
	return `raw=${rawOutput.length} {${rawCounts}}; sanitized=${sanitizedOutput.length} {${sanitizedCounts}}; sample=${sample || "<empty>"}`;
}

function countValues(values: readonly string[]): string {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return Array.from(counts.entries()).map(([value, count]) => `${value}:${count}`).join(", ");
}
