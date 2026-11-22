export function formatUtcMinute(date: Date = new Date()): string {
	return date.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
}
