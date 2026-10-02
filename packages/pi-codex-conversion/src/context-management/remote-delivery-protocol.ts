export const REMOTE_DELIVERY_MESSAGE = "codex-remote-delivery";
export const REMOTE_DELIVERY_RECEIVER = "_pi_remote_delivery";

export function isEncryptedFunctionOutput(item: unknown): item is Record<string, unknown> & { type: "function_call_output"; output: unknown[] } {
	return isRecord(item) && item["type"] === "function_call_output" && Array.isArray(item["output"]) &&
		item["output"].some(part => isRecord(part) && part["type"] === "encrypted_content");
}

export function isOriginalExecCall(item: unknown): item is Record<string, unknown> & { type: "custom_tool_call"; name: "exec" } {
	return isRecord(item) && item["type"] === "custom_tool_call" && item["name"] === "exec" &&
		(item["namespace"] === undefined || item["namespace"] === "" || item["namespace"] === "functions");
}

/** Protected pairs must be rejected before generic history repair can erase evidence. */
export function assertRemoteDeliveryPairs(input: readonly unknown[]): number {
	const encrypted = new Set<string>();
	let relayed = 0;
	for (let index = 0; index < input.length; index++) {
		const output = input[index];
		if (!isEncryptedFunctionOutput(output)) continue;
		const id = output["call_id"];
		const call = input.slice(0, index).find(item => isRecord(item) && item["call_id"] === id &&
			(item["type"] === "function_call" || isOriginalExecCall(item)));
		const key = JSON.stringify(output);
		if (typeof id !== "string" || !id || !call || encrypted.has(key))
			throw new Error("Invalid encrypted Remote output ancestry or duplicate");
		if (isRecord(call) && call["type"] === "function_call" && call["name"] === "exec")
			throw new Error("Encrypted Remote output does not match its recorded custom exec call");
		encrypted.add(key);
		if (isOriginalExecCall(call)) {
			const calls = input.flatMap((item, at) => isRecord(item) && item["call_id"] === id &&
				(item["type"] === "function_call" || item["type"] === "custom_tool_call") ? [at] : []);
			const receipts = input.flatMap((item, at) => isRecord(item) && item["call_id"] === id &&
				item["type"] === "custom_tool_call_output" ? [at] : []);
			const [callIndex] = calls;
			const [receiptIndex] = receipts;
			if (calls.length !== 1 || receipts.length !== 1 || callIndex === undefined || receiptIndex === undefined ||
				callIndex >= receiptIndex || receiptIndex >= index)
				throw new Error("Encrypted Remote output is missing its original exec receipt or order");
			relayed++;
		}
	}
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
	return seen.size + relayed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
