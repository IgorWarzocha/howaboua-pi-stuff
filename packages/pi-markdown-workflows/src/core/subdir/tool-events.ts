export type DiscoveryEvent = {
	toolName: string;
	input: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
};

type ToolResultEvent = DiscoveryEvent & { details?: unknown };

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function contentItems(value: unknown): DiscoveryEvent["content"] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is { type: string; text?: string } => {
		const record = objectRecord(item);
		return Boolean(
			record &&
				typeof record["type"] === "string" &&
				(record["text"] === undefined || typeof record["text"] === "string"),
		);
	});
}

export function codeModeDiscoveryEvents(
	event: ToolResultEvent,
): DiscoveryEvent[] {
	const events: DiscoveryEvent[] = [event];
	const details = objectRecord(event.details);
	if (details?.["codeMode"] !== true || !Array.isArray(details["traces"]))
		return events;

	for (const value of details["traces"]) {
		const trace = objectRecord(value);
		if (trace?.["status"] !== "done" || typeof trace["name"] !== "string")
			continue;
		const input = objectRecord(trace["input"]);
		const result = objectRecord(trace["result"]);
		const content = contentItems(result?.["content"]);
		if (!input || !content) continue;
		events.push({ toolName: trace["name"], input, content });
	}
	return events;
}
