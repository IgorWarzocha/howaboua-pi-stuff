import type { ToolCall } from "@earendil-works/pi-ai";

/** Recorded wire provenance survives model switches and declaration removal. */
export type ResponsesToolCall = ToolCall & { responsesCustomInputProperty?: string; responsesNamespace?: string };

export function recordedResponsesNamespace(block: ToolCall): string | undefined {
	if (!("responsesNamespace" in block)) return undefined;
	const namespace = block.responsesNamespace;
	if (typeof namespace !== "string" || !namespace || namespace !== block.namespace)
		throw new Error("Invalid persisted Responses namespace provenance");
	return namespace;
}

export function recordedCustomInputProperty(block: ToolCall, sourceApi: string): string | undefined {
	if ("responsesCustomInputProperty" in block) {
		const property = block.responsesCustomInputProperty;
		if (typeof property !== "string" || !property)
			throw new Error("Invalid persisted Responses custom-call provenance");
		return property;
	}
	// Older exec records carry their native wire kind in the provider's type-specific item ID.
	if (block.name !== "exec" || !block.id.split("|")[1]?.startsWith("ctc_") ||
		(sourceApi !== "openai-responses" && sourceApi !== "openai-codex-responses")) return undefined;
	const inputs = Object.entries(block.arguments);
	const input = inputs[0];
	if (inputs.length !== 1 || !input || typeof input[1] !== "string")
		throw new Error("Invalid persisted custom exec input");
	return input[0];
}

export interface ImageGenerationCallItem {
	type: "image_generation_call";
	id: string;
	status: string;
	result: string | null;
	revised_prompt?: string | undefined;
}

export interface ImageGenerationCallBlock {
	type: "image_generation_call";
	item: ImageGenerationCallItem;
}

export interface WebSearchCallItem {
	type: "web_search_call";
	id: string;
	status?: string | undefined;
	action?: unknown | undefined;
	results?: unknown | undefined;
}

export interface WebSearchCallBlock {
	type: "web_search_call";
	item: WebSearchCallItem;
}

export type ImageDetail = "auto" | "high" | "original";

export function encryptedOutputFromWebRunLike(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const encryptedOutput = (value as Record<string, unknown>)["encrypted_output"];
	return typeof encryptedOutput === "string" && encryptedOutput.trim() ? encryptedOutput : undefined;
}

export function encryptedWebRunOutputFromDetails(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined;
	const record = details as Record<string, unknown>;
	return encryptedOutputFromWebRunLike(record["webRun"]);
}

export function encryptedToolOutputFromDetails(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined;
	const record = details as Record<string, unknown>;
	return encryptedWebRunOutputFromDetails(details)
		?? encryptedOutputFromWebRunLike(record["codexHistoryNotes"]);
}

export function opaqueToolOutputsFromDetails(details: unknown): Array<{ resultId: string; name: string; encryptedOutput: string }> {
	if (!details || typeof details !== "object") return [];
	const record = details as Record<string, unknown>;
	if (record["codeMode"] !== true || !Array.isArray(record["opaqueOutputs"])) return [];
	return record["opaqueOutputs"].map((item: unknown) => {
		if (!item || typeof item !== "object") throw new Error("Invalid protected tool output");
		const value = item as Record<string, unknown>;
		if (typeof value["resultId"] !== "string" || typeof value["name"] !== "string" ||
			typeof value["encryptedOutput"] !== "string" || !value["encryptedOutput"].trim())
			throw new Error("Invalid protected tool output");
		return { resultId: value["resultId"], name: value["name"], encryptedOutput: value["encryptedOutput"] };
	});
}

export function isImageGenerationCallBlock(block: { type: string; item?: unknown }): block is ImageGenerationCallBlock {
	return block.type === "image_generation_call" && typeof block.item === "object" && block.item !== null && (block.item as Record<string, unknown>)["type"] === "image_generation_call";
}

export function isWebSearchCallBlock(block: { type: string; item?: unknown }): block is WebSearchCallBlock {
	return block.type === "web_search_call" && typeof block.item === "object" && block.item !== null && (block.item as Record<string, unknown>)["type"] === "web_search_call";
}

export function sanitizeImageGenerationCallItem(item: unknown): ImageGenerationCallItem | undefined {
	if (!item || typeof item !== "object") return undefined;
	const candidate = item as Record<string, unknown>;
	if (candidate["type"] !== "image_generation_call") return undefined;
	if (typeof candidate["id"]! !== "string" || candidate["id"] === "") return undefined;
	if (typeof candidate["status"]! !== "string" || candidate["status"] === "") return undefined;
	if (!(typeof candidate["result"]! === "string" || candidate["result"] === null)) return undefined;

	return {
		type: "image_generation_call",
		id: candidate["id"]!,
		status: candidate["status"]!,
		result: candidate["result"]!,
		...(typeof candidate["revised_prompt"]! === "string" ? { revised_prompt: candidate["revised_prompt"]! } : {}),
	};
}

export function sanitizeWebSearchCallItem(item: unknown): WebSearchCallItem | undefined {
	if (!item || typeof item !== "object") return undefined;
	const candidate = item as Record<string, unknown>;
	if (candidate["type"] !== "web_search_call") return undefined;
	if (typeof candidate["id"]! !== "string" || candidate["id"] === "") return undefined;

	return {
		type: "web_search_call",
		id: candidate["id"]!,
		...(typeof candidate["status"]! === "string" ? { status: candidate["status"]! } : {}),
		...(candidate["action"] !== undefined ? { action: candidate["action"]! } : {}),
		...(candidate["results"] !== undefined ? { results: candidate["results"]! } : {}),
	};
}

export function imageDetailForResponses(block: unknown): ImageDetail {
	const detail = block && typeof block === "object" ? (block as Record<string, unknown>)["detail"] : undefined;
	return detail === "high" || detail === "original" ? detail : "auto";
}
