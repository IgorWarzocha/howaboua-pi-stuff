import { isObject } from "./config-values.ts";

export type ModelScopeMode = "automatic" | "all" | "selected";

export function normalizeModelScopeMode(
	value: unknown,
): ModelScopeMode | undefined {
	return value === "automatic" || value === "all" || value === "selected"
		? value
		: undefined;
}

export function legacyAllProvidersMode(
	value: unknown,
): ModelScopeMode | undefined {
	if (value === true || value === "on") return "all";
	if (value === false || value === "off" || value === "extras")
		return "automatic";
	return undefined;
}

interface ScopedModel {
	provider: string;
	id: string;
}

export interface ModelScopeOverride extends ScopedModel {
	enabled: boolean;
}

export function sameScopedModel(
	left: ScopedModel,
	right: ScopedModel,
): boolean {
	return left.provider === right.provider && left.id === right.id;
}

export function getModelScopeOverride(
	overrides: readonly ModelScopeOverride[],
	model: ScopedModel,
): boolean | undefined {
	return overrides.find((entry) => sameScopedModel(entry, model))?.enabled;
}

export function normalizeModelScopeOverrides(
	value: unknown,
): ModelScopeOverride[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (!isObject(entry)) return [];
		const { provider, id, enabled } = entry;
		return typeof provider === "string" &&
			provider &&
			typeof id === "string" &&
			id &&
			typeof enabled === "boolean"
			? [{ provider, id, enabled }]
			: [];
	});
}
