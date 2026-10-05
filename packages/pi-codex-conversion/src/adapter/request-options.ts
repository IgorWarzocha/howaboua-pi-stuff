import { isObject, type CodexConversionConfig } from "./activation/config.ts";
import { isFastModeEnabled } from "./activation/fast-mode.ts";

export function applyCodexRequestOptions(
	payload: unknown,
	config: CodexConversionConfig,
	options: { modelId?: string | undefined; serviceTier?: boolean | undefined; verbosity?: boolean | undefined } = { serviceTier: true, verbosity: true },
): unknown {
	if (!isObject(payload)) return payload;
	const text = isObject(payload["text"]!) ? payload["text"]! : {};
	const modelId = typeof payload["model"] === "string" ? payload["model"] : options.modelId;
	return {
		...payload,
		...(options.serviceTier && isFastModeEnabled(config.openai.fast, modelId) ? { service_tier: "priority" } : {}),
		...(options.verbosity ? { text: { ...text, verbosity: config.openai.verbosity } } : {}),
	};
}
