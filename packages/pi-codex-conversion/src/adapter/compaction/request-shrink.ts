import type { NativeCompactionRequestBody, ResponsesInputItem } from "./serializer.ts";

export const COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE = "[truncated]";

const COMPACTION_BUDGET_RATIO = 0.8;

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

function isRewritableToolOutputItem(item: ResponsesInputItem): item is ResponsesInputItem & { type: string; output: unknown } {
	if (!isRecord(item)) return false;
	const record: Record<string, unknown> = item;
	return record["type"] === "function_call_output" && record["output"] !== COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE;
}

function rewriteToolOutputItem(item: ResponsesInputItem & { output: unknown }): ResponsesInputItem {
	return {
		...item,
		output: COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE,
	} as ResponsesInputItem;
}

function compactRequestBudget(options: ShrinkNativeCompactionRequestOptions): number | undefined {
	const contextWindow = options.contextWindow;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
	return Math.floor(contextWindow * COMPACTION_BUDGET_RATIO);
}

export async function shrinkNativeCompactionRequestForEndpoint(
	request: NativeCompactionRequestBody,
	options: ShrinkNativeCompactionRequestOptions = {},
): Promise<NativeCompactionShrinkResult> {
	const encoding = await getTokenEncoder();
	const budgetTokens = compactRequestBudget(options);
	const estimatedTokensBefore = estimateTokenCount(request, encoding);
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

	for (let index = 0; index < request.input.length && estimatedTokensAfter > budgetTokens; index++) {
		const item = (input ?? request.input)[index]!;
		if (!isRewritableToolOutputItem(item)) continue;

		input ??= [...request.input];
		const rewrittenItem = rewriteToolOutputItem(item);
		input[index] = rewrittenItem;
		rewrittenOutputs++;
		estimatedTokensAfter += estimateTokenCount(rewrittenItem, encoding) - estimateTokenCount(item, encoding);
	}

	return {
		request: input ? { ...request, input } : request,
		rewrittenOutputs,
		estimatedTokensBefore,
		estimatedTokensAfter,
		budgetTokens,
	};
}
