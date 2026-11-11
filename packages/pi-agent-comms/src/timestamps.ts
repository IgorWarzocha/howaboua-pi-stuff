export function minuteTimestamp(value: string | number = Date.now()): string {
	return new Date(value).toISOString().slice(0, 16) + "Z";
}
