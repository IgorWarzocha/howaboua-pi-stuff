import type { CdpConnection } from "./types.js";
import { asRecord } from "./types.js";

export async function evaluate(
	cdp: CdpConnection,
	sessionId: string,
	expression: string,
	signal?: AbortSignal,
): Promise<unknown> {
	await cdp.send("Runtime.enable", {}, sessionId, signal);
	const response = asRecord(
		await cdp.send(
			"Runtime.evaluate",
			{
				expression,
				returnByValue: true,
				awaitPromise: true,
			},
			sessionId,
			signal,
		),
		"Runtime.evaluate response",
	);
	const exception = response["exceptionDetails"];
	if (exception) {
		const details = asRecord(exception, "Runtime exception");
		const nested =
			details["exception"] &&
			typeof details["exception"] === "object" &&
			!Array.isArray(details["exception"])
				? (details["exception"] as Record<string, unknown>)
				: undefined;
		throw new Error(
			typeof nested?.["description"] === "string"
				? nested["description"]
				: typeof details["text"] === "string"
					? details["text"]
					: "Runtime evaluation failed",
		);
	}
	const result = asRecord(response["result"], "Runtime result");
	return result["value"];
}

export async function evaluateText(
	cdp: CdpConnection,
	sessionId: string,
	expression: string,
	signal?: AbortSignal,
): Promise<string> {
	const value = await evaluate(cdp, sessionId, expression, signal);
	return typeof value === "object" && value !== null
		? JSON.stringify(value, null, 2)
		: String(value ?? "");
}
