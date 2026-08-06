import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	generateBranchSummary,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedSummaryConfig } from "./types.js";

interface TreeNavigationOptions {
	summarize: true;
	customInstructions?: string;
	replaceInstructions?: boolean;
}

interface PendingSummary {
	token: object;
	targetId: string;
	config: ResolvedSummaryConfig;
}

export type NavigateWithSummaryModel = (
	ctx: ExtensionCommandContext,
	targetId: string,
	options: TreeNavigationOptions,
	config: ResolvedSummaryConfig,
) => ReturnType<ExtensionCommandContext["navigateTree"]>;

export function registerTreeSummaryModel(
	pi: ExtensionAPI,
): NavigateWithSummaryModel {
	let pending: PendingSummary | undefined;

	pi.on("session_before_tree", async (event, ctx) => {
		const request = pending;
		if (
			!request ||
			event.preparation.targetId !== request.targetId ||
			!event.preparation.userWantsSummary
		)
			return;

		const parsed = request.config.modelParsed;
		const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
		const provider = model
			? ctx.modelRegistry.getProvider(model.provider)
			: undefined;
		if (!model || !provider) {
			ctx.ui.notify(
				`Configured summary model ${request.config.model} unavailable; falling back to the current session model.`,
				"warning",
			);
			return;
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			ctx.ui.notify(
				`Configured summary model ${request.config.model} unavailable; falling back to the current session model.`,
				"warning",
			);
			return;
		}
		const summaryModel = auth.baseUrl
			? { ...model, baseUrl: auth.baseUrl }
			: model;

		try {
			const result = await generateBranchSummary(
				event.preparation.entriesToSummarize,
				{
					model: summaryModel,
					signal: event.signal,
					...(event.preparation.customInstructions !== undefined
						? { customInstructions: event.preparation.customInstructions }
						: {}),
					...(event.preparation.replaceInstructions !== undefined
						? { replaceInstructions: event.preparation.replaceInstructions }
						: {}),
					streamFn: (streamModel, context, options) =>
						provider.streamSimple(streamModel, context, {
							...options,
							...(auth.apiKey !== undefined ? { apiKey: auth.apiKey } : {}),
							...(auth.headers !== undefined ? { headers: auth.headers } : {}),
							...(auth.env !== undefined ? { env: auth.env } : {}),
							...(streamModel.reasoning && request.config.thinking !== "off"
								? { reasoning: request.config.thinking }
								: {}),
						}),
				},
			);

			if (result.aborted) return { cancel: true as const };
			if (result.error || !result.summary) {
				ctx.ui.notify(
					`Configured summary model failed${result.error ? `: ${result.error}` : ""}; falling back to the current session model.`,
					"warning",
				);
				return;
			}

			return {
				summary: {
					summary: result.summary,
					details: {
						readFiles: result.readFiles ?? [],
						modifiedFiles: result.modifiedFiles ?? [],
					},
					...(result.usage !== undefined ? { usage: result.usage } : {}),
				},
			};
		} catch (error) {
			if (event.signal.aborted) return { cancel: true as const };
			ctx.ui.notify(
				`Configured summary model failed: ${error instanceof Error ? error.message : String(error)}; falling back to the current session model.`,
				"warning",
			);
		}
	});

	return async (ctx, targetId, options, config) => {
		if (!config.enabled) return ctx.navigateTree(targetId, options);
		if (pending) throw new Error("A tree summary is already in progress");

		const token = {};
		pending = { token, targetId, config };
		try {
			return await ctx.navigateTree(targetId, options);
		} finally {
			if (pending?.token === token) pending = undefined;
		}
	};
}
