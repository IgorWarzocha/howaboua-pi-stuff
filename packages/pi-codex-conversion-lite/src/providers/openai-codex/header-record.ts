export function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}
