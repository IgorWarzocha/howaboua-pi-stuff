import { WEB_SEARCH_MAX_OUTPUT_TOKENS, type WebRunOutput } from "./contract.js";

export function buildWebSearchRequest(
	params: Record<string, unknown>,
	options: { id: string; model: string },
): Record<string, unknown> {
	const {
		settings: configuredSettings,
		max_output_tokens: _ignoredOutputOverride,
		...commands
	} = params;
	const settings =
		configuredSettings &&
		typeof configuredSettings === "object" &&
		!Array.isArray(configuredSettings)
			? { ...(configuredSettings as Record<string, unknown>) }
			: {};
	settings["allowed_callers"] ??= ["direct"];
	settings["external_web_access"] ??= true;
	return {
		id: options.id,
		model: options.model,
		commands,
		settings,
		max_output_tokens: WEB_SEARCH_MAX_OUTPUT_TOKENS,
	};
}

export function normalizeSearchResponse(value: unknown): WebRunOutput {
	if (!value || typeof value !== "object")
		throw new Error("web_run returned invalid JSON");
	const parsed = value as Record<string, unknown>;
	if (
		typeof parsed["output_text"] === "string" ||
		Array.isArray(parsed["search_results"])
	)
		return parsed as WebRunOutput;
	if (typeof parsed["output"] !== "string")
		throw new Error("web_run search returned no output");
	return {
		output_text: parsed["output"],
		search_results: Array.isArray(parsed["results"]) ? parsed["results"] : [],
	};
}
