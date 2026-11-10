export function formatUtcMinute(date: Date = new Date()): string {
	return date.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
}

/** Render legacy metadata without changing stored values or hiding invalid strings. */
export function formatStoredUtcMinute(value: string): string {
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? formatUtcMinute(date) : value;
}
