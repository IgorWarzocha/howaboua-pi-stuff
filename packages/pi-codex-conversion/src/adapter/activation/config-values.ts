import type { VoiceContextModel } from "./config-contract.ts";

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function normalizeString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized && Buffer.byteLength(normalized) <= 512
		? normalized
		: undefined;
}

export function normalizeIntegerInRange(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= minimum &&
		value <= maximum
		? value
		: fallback;
}

export function normalizeVoiceContextModel(
	value: unknown,
): VoiceContextModel | undefined {
	if (!isObject(value)) return undefined;
	const provider = normalizeOptionalString(value["provider"]);
	const modelId = normalizeOptionalString(value["modelId"]);
	return provider && modelId ? { provider, modelId } : undefined;
}

export function normalizeNotebookProfile(value: unknown): string | undefined {
	const name = normalizeOptionalString(value);
	return name && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
		? name
		: undefined;
}
