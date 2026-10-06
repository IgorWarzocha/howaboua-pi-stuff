import type { FastModeConfig, FastModeFamily } from "./config-contract.ts";
import { isObject, normalizeBoolean } from "./config-values.ts";

export function normalizeFastMode(value: unknown): FastModeConfig {
	// Booleans applied to every model, including families we do not recognize.
	const fallback = typeof value === "boolean" ? value : false;
	const families = isObject(value) ? value : {};
	return {
		astra: normalizeBoolean(families["astra"], fallback),
		sol: normalizeBoolean(families["sol"], fallback),
		terra: normalizeBoolean(families["terra"], fallback),
		luna: normalizeBoolean(families["luna"], fallback),
		other: normalizeBoolean(families["other"], fallback),
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

export function allModelsFastModeState(fast: FastModeConfig): "on" | "off" | "mixed" {
	const values = Object.values(fast);
	return values.every(Boolean) ? "on" : values.some(Boolean) ? "mixed" : "off";
}

export function isFastModeEnabled(fast: FastModeConfig, modelId: string | undefined): boolean {
	return fast[resolveFastModeFamily(modelId) ?? "other"];
}
