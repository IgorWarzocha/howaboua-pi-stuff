import type { FastModeConfig, FastModeFamily } from "./config-contract.ts";
import { isObject, normalizeBoolean } from "./config-values.ts";

function normalizeFastModeValue(value: unknown, fallback: boolean | "ultrafast"): boolean | "ultrafast" {
	return value === "ultrafast" ? value : normalizeBoolean(value, fallback === "ultrafast" ? false : fallback);
}

export function normalizeFastMode(value: unknown): FastModeConfig {
	// Booleans applied to every model, including families we do not recognize.
	const fallback = typeof value === "boolean" || value === "ultrafast" ? value : false;
	const families = isObject(value) ? value : {};
	return {
		astra: normalizeFastModeValue(families["astra"] ?? fallback, fallback),
		sol: normalizeFastModeValue(families["sol"] ?? fallback, fallback),
		terra: normalizeFastModeValue(families["terra"] ?? fallback, fallback),
		luna: normalizeFastModeValue(families["luna"] ?? fallback, fallback),
		other: normalizeFastModeValue(families["other"] ?? fallback, fallback),
	};
}

function resolveFastModeFamily(modelId: string | undefined): FastModeFamily | undefined {
	const id = modelId?.split("/").at(-1)?.trim().toLowerCase();
	// The backend's reserve route is Luna without a family suffix.
	if (id === "gpt-reserve") return "luna";
	const family = /^gpt-\d+(?:\.\d+)*-(astra|sol|terra|luna)(?:-|$)/.exec(id ?? "")?.[1];
	return family === "astra" || family === "sol" || family === "terra" || family === "luna"
		? family : undefined;
}

export function allModelsFastModeState(fast: FastModeConfig): "on" | "off" | "ultrafast" | "mixed" {
	const values = Object.values(fast);
	return values.every((value) => value === "ultrafast") ? "ultrafast"
		: values.every((value) => value === true) ? "on"
		: values.every((value) => value === false) ? "off" : "mixed";
}

export function resolveFastModeServiceTier(fast: FastModeConfig, modelId: string | undefined): "priority" | "ultrafast" | undefined {
	const value = fast[resolveFastModeFamily(modelId) ?? "other"];
	return value === "ultrafast" ? "ultrafast" : value ? "priority" : undefined;
}
