import type { ResponsesInputContentItem, ResponsesInputItem, ResponsesInputMessageItem } from "../compaction/serializer.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isResponsesInputContentItem(value: unknown): value is ResponsesInputContentItem {
	if (!isRecord(value) || typeof value["type"]! !== "string") return false;
	if (value["type"] === "input_text") return typeof value["text"]! === "string";
	if (value["type"] === "input_image") return value["detail"] === "auto" && typeof value["image_url"]! === "string";
	if (value["type"] === "encrypted_content") return typeof value["encrypted_content"]! === "string";
	return false;
}

export function isResponsesInputMessageRole(value: unknown): value is ResponsesInputMessageItem["role"] {
	return value === "user" || value === "developer" || value === "system";
}

export function isPreambleRole(value: ResponsesInputMessageItem["role"]): value is "developer" | "system" {
	return value === "developer" || value === "system";
}

export function isResponsesInputMessageItem(value: unknown): value is ResponsesInputMessageItem {
	if (!isRecord(value) || !isResponsesInputMessageRole(value["role"]!)) return false;
	const { content } = value;
	return typeof content === "string" || (Array.isArray(content) && content.every(isResponsesInputContentItem));
}

function cloneResponsesInputContentItem(item: ResponsesInputContentItem): ResponsesInputContentItem {
	if (item.type === "input_text") return { type: "input_text", text: item.text };
	if (item.type === "encrypted_content") return { type: "encrypted_content", encrypted_content: item.encrypted_content };
	return { type: "input_image", detail: "auto", image_url: item.image_url };
}

export function cloneResponsesInputMessageItem(item: ResponsesInputMessageItem): ResponsesInputMessageItem {
	return { role: item.role, content: typeof item.content === "string" ? item.content : item.content.map(cloneResponsesInputContentItem) };
}

export function cloneStructuredValue(value: unknown): unknown {
	if (value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.map(cloneStructuredValue);
	if (isRecord(value)) {
		const clone: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) clone[key] = cloneStructuredValue(nested);
		return clone;
	}
	throw new Error(`Unsupported structured value: ${typeof value}`);
}

export function cloneOpaqueCompactedWindow(compactedWindow: readonly unknown[]): unknown[] | undefined {
	const cloned: unknown[] = [];
	for (const item of compactedWindow) {
		if (!isRecord(item)) return undefined;
		try { cloned.push(cloneStructuredValue(item)); } catch { return undefined; }
	}
	return cloned;
}

export function cloneResponsesInputSlice(items: readonly unknown[]): ResponsesInputItem[] | undefined {
	const cloned: ResponsesInputItem[] = [];
	for (const item of items) {
		try { cloned.push(cloneStructuredValue(item) as ResponsesInputItem); } catch { return undefined; }
	}
	return cloned;
}

export function areEquivalentValues(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index++) {
			if (!areEquivalentValues(left[index]!, right[index]!)) return false;
		}
		return true;
	}
	if (isRecord(left) || isRecord(right)) {
		if (!isRecord(left) || !isRecord(right)) return false;
		const leftKeys = Object.keys(left).sort();
		const rightKeys = Object.keys(right).sort();
		if (!areEquivalentValues(leftKeys, rightKeys)) return false;
		for (const key of leftKeys) {
			if (!areEquivalentValues(left[key]!, right[key]!)) return false;
		}
		return true;
	}
	return false;
}

