export function webRunCodeModeResult(result: {
	details?: unknown;
	content: Array<{ type: string; text?: string }>;
}): unknown {
	const details = result.details;
	if (
		details &&
		typeof details === "object" &&
		"webRun" in details &&
		details.webRun &&
		typeof details.webRun === "object"
	)
		return details.webRun;
	return (
		result.content
			.filter(
				(item): item is { type: string; text: string } =>
					item.type === "text" && typeof item.text === "string",
			)
			.map((item) => item.text)
			.join("\n") || "(no output)"
	);
}
