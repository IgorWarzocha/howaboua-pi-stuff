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

// null is an explicit Default: follow mode without inheriting or reseeding a rule.
export type ModelScopeOverride = boolean | null;
export type ModelScopeOverrides = Record<
	string,
	Record<string, ModelScopeOverride>
>;

export function getModelScopeOverride(
	overrides: ModelScopeOverrides,
	model: ScopedModel,
): ModelScopeOverride | undefined {
	const models = Object.hasOwn(overrides, model.provider)
		? overrides[model.provider]
		: undefined;
	return models && Object.hasOwn(models, model.id)
		? models[model.id]
		: undefined;
}

export function withModelScopeOverride(
	overrides: ModelScopeOverrides,
	model: ScopedModel,
	value: ModelScopeOverride,
): ModelScopeOverrides {
	return {
		...overrides,
		[model.provider]: { ...overrides[model.provider], [model.id]: value },
	};
}

export function normalizeModelScopeOverrides(
	value: unknown,
): ModelScopeOverrides {
	if (!isObject(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([provider, models]) =>
			provider && isObject(models)
				? [
						[
							provider,
							Object.fromEntries(
								Object.entries(models).flatMap(([id, rule]) =>
									id && (typeof rule === "boolean" || rule === null)
										? [[id, rule] as const]
										: [],
								),
							),
						],
					]
				: [],
		),
	);
}

// The PR originally wrote flat rules. Keep those work-in-progress settings.
export function migrateFlatModelScopeOverrides(
	value: readonly unknown[],
): ModelScopeOverrides {
	let rules: ModelScopeOverrides = {};
	for (const row of value) {
		if (!isObject(row)) continue;
		const { provider, id, enabled } = row;
		if (
			typeof provider !== "string" ||
			!provider ||
			typeof id !== "string" ||
			!id ||
			typeof enabled !== "boolean"
		)
			continue;
		const model = { provider, id };
		if (getModelScopeOverride(rules, model) === undefined)
			rules = withModelScopeOverride(rules, model, enabled);
	}
	return rules;
}
