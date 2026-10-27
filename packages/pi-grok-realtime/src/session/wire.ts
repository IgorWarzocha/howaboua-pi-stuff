function diagnosticSession(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const session = value as Record<string, unknown>;
	// Log effective configuration, never arbitrary provider auth/session fields.
	return Object.fromEntries(
		[
			"voice",
			"instructions",
			"tools",
			"tool_choice",
			"reasoning",
			"audio",
			"turn_detection",
		]
			.filter((key) => key in session)
			.map((key) => [key, session[key]]),
	);
}

function diagnosticToolFields(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const item = value as Record<string, unknown>;
	return Object.fromEntries(
		[
			"id",
			"type",
			"name",
			"arguments",
			"output",
			"status",
			"action",
			"query",
			"queries",
			"results",
			"sources",
			"url",
			"title",
			"error",
			"output_index",
		]
			.filter((key) => key in item)
			.map((key) => [key, item[key]]),
	);
}

export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid Grok voice object");
	return value as Record<string, unknown>;
}
export function textField(
	value: Record<string, unknown>,
	key: string,
): string | undefined {
	return typeof value[key] === "string" ? value[key] : undefined;
}

export function isBase64(value: string): boolean {
	if (value.length % 4) return false;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	for (let index = 0; index < value.length - padding; index++) {
		const code = value.charCodeAt(index);
		if (
			!(
				(code >= 65 && code <= 90) ||
				(code >= 97 && code <= 122) ||
				(code >= 48 && code <= 57) ||
				code === 43 ||
				code === 47
			)
		)
			return false;
	}
	return true;
}

export function diagnosticEvent(
	event: Record<string, unknown>,
): Record<string, unknown> {
	const type = event["type"];
	return {
		direction: "received",
		type,
		response_id: event["response_id"],
		item_id: event["item_id"],
		call_id: event["call_id"],
		...diagnosticToolFields(event),
		...(event["item"] ? { item: diagnosticToolFields(event["item"]) } : {}),
		...(type === "error" ? { error: event["error"] } : {}),
		...(type === "response.done" ? { response: event["response"] } : {}),
		...(type === "response.created" ? { response: event["response"] } : {}),
		...(type === "session.created" || type === "session.updated"
			? { session: diagnosticSession(event["session"]) }
			: {}),
	};
}
