export const REMOTE_DELIVERY_MESSAGE = "codex-remote-delivery";
export const REMOTE_DELIVERY_RECEIVER = "_pi_remote_delivery";

/** Protected pairs must be rejected before generic history repair can erase evidence. */
export function assertRemoteDeliveryPairs(input: readonly unknown[]): number {
	const seen = new Set<string>();
	for (let index = 0; index < input.length; index++) {
		const call = input[index];
		if (!isRecord(call) || !(call["name"] === REMOTE_DELIVERY_RECEIVER ||
			typeof call["call_id"] === "string" && call["call_id"].startsWith("host_delivery_"))) continue;
		const id = call["call_id"];
		const output = input[index + 1];
		if (call["type"] !== "function_call" || call["name"] !== REMOTE_DELIVERY_RECEIVER ||
			typeof id !== "string" || !/^host_delivery_[a-f0-9]{32}$/.test(id) || seen.has(id) ||
			!isRecord(output) || output["type"] !== "function_call_output" || output["call_id"] !== id)
			throw new Error("Invalid Remote delivery pair or order");
		seen.add(id);
		index++;
	}
	return seen.size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
