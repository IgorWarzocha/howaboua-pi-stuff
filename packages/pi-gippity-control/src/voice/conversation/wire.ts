export function transcriptItemText(value: unknown): unknown {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)["text"]
		: undefined;
}

export function remoteError(event: Record<string, unknown>): string {
	if (typeof event["message"] === "string") return event["message"];
	const error = event["error"];
	return error &&
		typeof error === "object" &&
		typeof (error as Record<string, unknown>)["message"] === "string"
		? ((error as Record<string, unknown>)["message"] as string)
		: "Codex realtime error";
}

export function utf8Chunks(input: string, maxBytes: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const character of input) {
		if (Buffer.byteLength(current + character) > maxBytes && current) {
			chunks.push(current);
			current = character;
		} else current += character;
	}
	if (current) chunks.push(current);
	return chunks;
}

export function realtimePeerStateFailure(state: string): string | undefined {
	if (state === "failed") return "Codex realtime connection failed";
	if (state === "closed") return "Codex realtime connection closed";
	return undefined;
}
