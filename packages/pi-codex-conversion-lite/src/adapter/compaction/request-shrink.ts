import type { NativeCompactionRequestBody, ResponsesInputItem } from "./serializer.ts";

export const COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE = "Output exceeded the available model context and was truncated";
const CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;

export type NativeCompactionShrinkResult = {
	request: NativeCompactionRequestBody;
	rewrittenOutputs: number;
	estimatedTokensBefore: number;
	estimatedTokensAfter: number;
	budgetTokens?: number | undefined;
};

export type ShrinkNativeCompactionRequestOptions = {
	contextWindow?: number | null | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

type TokenEncoder = { encode(value: string): ArrayLike<unknown> };
let tokenEncoderPromise: Promise<TokenEncoder> | undefined;

function getTokenEncoder(): Promise<TokenEncoder> {
	tokenEncoderPromise ??= import("js-tiktoken").then(({ getEncoding }) => getEncoding("o200k_base"));
	return tokenEncoderPromise;
}

function estimateTokenCount(value: unknown, encoding: TokenEncoder): number {
	const serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "";
	try {
		return encoding.encode(serialized).length;
	} catch {
		return Math.ceil(serialized.length / 2);
	}
}

function rewriteToolOutputItem(item: ResponsesInputItem): { recognized: boolean; item: ResponsesInputItem } {
	if (!isRecord(item)) return { recognized: false, item };
	const record: Record<string, unknown> = item;
	if (record["type"] === "function_call_output" || record["type"] === "custom_tool_call_output") {
		if (record["output"] === COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE) return { recognized: true, item };
		return { recognized: true, item: { ...record, output: COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE } as ResponsesInputItem };
	}
	if (record["type"] === "tool_search_output") {
		if (Array.isArray(record["tools"]) && record["tools"].length === 0) return { recognized: true, item };
		return { recognized: true, item: { ...record, tools: [] } as unknown as ResponsesInputItem };
	}
	return { recognized: false, item };
}

function compactRequestBudget(options: ShrinkNativeCompactionRequestOptions): number | undefined {
	const contextWindow = options.contextWindow;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
	return Math.floor((contextWindow * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT) / 100);
}

function estimateCompactContextTokens(request: NativeCompactionRequestBody, encoding: TokenEncoder): number {
	return estimateTokenCount(request.instructions ?? "", encoding) + estimateTokenCount(request.input, encoding);
}

export async function shrinkNativeCompactionRequestForEndpoint(
	request: NativeCompactionRequestBody,
	options: ShrinkNativeCompactionRequestOptions = {},
): Promise<NativeCompactionShrinkResult> {
	const encoding = await getTokenEncoder();
	const budgetTokens = compactRequestBudget(options);
	const estimatedTokensBefore = estimateCompactContextTokens(request, encoding);
	if (budgetTokens === undefined || estimatedTokensBefore <= budgetTokens) {
		return {
			request,
			rewrittenOutputs: 0,
			estimatedTokensBefore,
			estimatedTokensAfter: estimatedTokensBefore,
			budgetTokens,
		};
	}

	let rewrittenOutputs = 0;
	let estimatedTokensAfter = estimatedTokensBefore;
	let input: ResponsesInputItem[] | undefined;

	for (let index = request.input.length - 1; index >= 0 && estimatedTokensAfter > budgetTokens; index--) {
		const item = (input ?? request.input)[index]!;
		const rewrite = rewriteToolOutputItem(item);
		if (!rewrite.recognized) break;
		if (rewrite.item === item) continue;

		input ??= [...request.input];
		input[index] = rewrite.item;
		rewrittenOutputs++;
		estimatedTokensAfter += estimateTokenCount(rewrite.item, encoding) - estimateTokenCount(item, encoding);
	}

	return {
		request: input ? { ...request, input } : request,
		rewrittenOutputs,
		estimatedTokensBefore,
		estimatedTokensAfter,
		budgetTokens,
	};
}
