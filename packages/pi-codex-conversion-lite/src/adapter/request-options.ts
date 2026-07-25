import { isObject, type CodexConversionConfig } from "./activation/config.ts";

export function applyCodexRequestOptions(
	payload: unknown,
	config: CodexConversionConfig,
	options: { serviceTier?: boolean | undefined; verbosity?: boolean | undefined } = { serviceTier: true, verbosity: true },
): unknown {
	if (!isObject(payload)) return payload;
	const text = isObject(payload["text"]!) ? payload["text"]! : {};
	return {
		...payload,
		...(options.serviceTier && config.openai.fast ? { service_tier: "priority" } : {}),
		...(options.verbosity ? { text: { ...text, verbosity: config.openai.verbosity } } : {}),
	};
}
