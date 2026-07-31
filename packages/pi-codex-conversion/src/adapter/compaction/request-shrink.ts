import type { NativeCompactionRequestBody, ResponsesInputItem } from "./serializer.ts";
import { supportsResponsesLiteModel } from "../../providers/openai-codex/responses-lite-model.ts";

export const COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE = "Output exceeded the available model context and was truncated";
export const OPENAI_CODEX_COMPACTION_ENDPOINT_BUDGET_TOKENS = 372_000;
const CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;

export type NativeCompactionShrinkResult = {
	request: NativeCompactionRequestBody;
	rewrittenOutputs: number;
};

export type ShrinkNativeCompactionRequestOptions = {
	budgetTokens?: number | null | undefined;
	tokensBefore: number;
};

export type NativeCompactionBudgetOptions = {
	provider: string;
	model: string;
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

export function resolveNativeCompactionRequestBudget(options: NativeCompactionBudgetOptions): number | undefined {
	if (options.provider === "openai-codex" && supportsResponsesLiteModel(options.model)) {
		return OPENAI_CODEX_COMPACTION_ENDPOINT_BUDGET_TOKENS;
	}
	const contextWindow = options.contextWindow;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
	return Math.floor((contextWindow * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT) / 100);
}

function compactRequestBudget(options: ShrinkNativeCompactionRequestOptions): number | undefined {
	const budgetTokens = options.budgetTokens;
	if (typeof budgetTokens !== "number" || !Number.isFinite(budgetTokens) || budgetTokens <= 0) return undefined;
	return Math.floor(budgetTokens);
}

function estimateCompactContextTokens(request: NativeCompactionRequestBody, encoding: TokenEncoder): number {
	return estimateTokenCount(request.instructions ?? "", encoding) + estimateTokenCount(request.input, encoding);
}

export async function shrinkNativeCompactionRequestForEndpoint(
	request: NativeCompactionRequestBody,
	options: ShrinkNativeCompactionRequestOptions,
): Promise<NativeCompactionShrinkResult> {
	const budgetTokens = compactRequestBudget(options);
	if (budgetTokens === undefined || !Number.isFinite(options.tokensBefore) || options.tokensBefore <= budgetTokens) {
		return { request, rewrittenOutputs: 0 };
	}

	const encoding = await getTokenEncoder();
	const estimatedTokensBefore = estimateCompactContextTokens(request, encoding);
	if (estimatedTokensBefore <= budgetTokens) {
		return { request, rewrittenOutputs: 0 };
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
	};
}
