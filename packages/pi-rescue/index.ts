import type {
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
	Usage,
} from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { type RescueConfig, readRescueConfig } from "./src/config.js";
import {
	buildRescueConversation,
	buildRescuePrompt,
	RESCUE_SYSTEM_PROMPT,
	truncateRescueText,
} from "./src/summary.js";

interface PendingRescue {
	instructions?: string;
}

interface RescueFileOperations {
	text: string;
	readFiles: string[];
	modifiedFiles: string[];
}

function configuredModel(
	ctx: ExtensionContext,
	config: RescueConfig,
): Model<any> | undefined {
	if (config.provider && config.model) {
		return ctx.modelRegistry.find(config.provider, config.model);
	}
	return ctx.model;
}

function notify(
	ctx: ExtensionContext,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

function fileOperationSummary(
	fileOps: SessionBeforeCompactEvent["preparation"]["fileOps"],
	maxTokens: number,
): RescueFileOperations {
	const modifiedFiles = [
		...new Set([...fileOps.written, ...fileOps.edited]),
	].sort();
	const modified = new Set(modifiedFiles);
	const readFiles = [...fileOps.read]
		.filter((file) => !modified.has(file))
		.sort();
	const lists = [
		readFiles.length > 0 ? { tag: "read-files", files: readFiles } : undefined,
		modifiedFiles.length > 0
			? { tag: "modified-files", files: modifiedFiles }
			: undefined,
	].filter(
		(list): list is { tag: string; files: string[] } => list !== undefined,
	);
	if (lists.length === 0 || maxTokens <= 0) {
		return { text: "", readFiles: [], modifiedFiles: [] };
	}

	const sectionTokens = Math.max(1, Math.floor(maxTokens / lists.length));
	const selected = new Map<string, string[]>();
	const sections = lists.map(({ tag, files }) => {
		const prefix = `<${tag}>\n`;
		const suffix = `\n</${tag}>`;
		const contentChars = Math.max(
			1,
			sectionTokens * 4 - prefix.length - suffix.length,
		);
		const omittedMarkerReserve = `[${files.length} more paths omitted]`;
		const boundedFiles: string[] = [];
		let usedChars = 0;
		for (const file of files) {
			const separator = boundedFiles.length > 0 ? 1 : 0;
			if (
				usedChars + separator + file.length >
				contentChars - omittedMarkerReserve.length - 1
			)
				break;
			boundedFiles.push(file);
			usedChars += separator + file.length;
		}
		const omitted = boundedFiles.length < files.length;
		const omittedMarker = `[${files.length - boundedFiles.length} more paths omitted]`;
		const content = [...boundedFiles, omitted ? omittedMarker : ""]
			.filter(Boolean)
			.join("\n");
		selected.set(tag, boundedFiles);
		return `${prefix}${content}${suffix}`;
	});
	const readSelected = selected.get("read-files") ?? [];
	const modifiedSelected = selected.get("modified-files") ?? [];
	return {
		text: sections.join("\n\n").replace(/^/, "\n\n"),
		readFiles: readSelected,
		modifiedFiles: modifiedSelected,
	};
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const MAX_RESCUE_OUTPUT_TOKENS = 8_192;
const MAX_RESCUE_INSTRUCTION_TOKENS = 2_048;
const PROMPT_SAFETY_MARGIN_TOKENS = 128;

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function rescueTokenBudgets(
	model: Model<any>,
	instructions: string | undefined,
): {
	input: number;
	output: number;
	instructions?: string;
} {
	const contextWindow = Math.max(
		1,
		model.contextWindow || DEFAULT_CONTEXT_WINDOW,
	);
	const output = Math.min(
		Math.max(1, Math.floor(contextWindow * 0.2)),
		Math.max(1, contextWindow - 1),
		Math.min(
			MAX_RESCUE_OUTPUT_TOKENS,
			model.maxTokens > 0
				? Math.max(1, Math.floor(model.maxTokens))
				: MAX_RESCUE_OUTPUT_TOKENS,
		),
	);
	const instructionLimit = Math.min(
		MAX_RESCUE_INSTRUCTION_TOKENS,
		Math.max(0, Math.floor(contextWindow * 0.1)),
	);
	const boundedInstructions = instructions?.trim()
		? truncateRescueText(
				instructions.trim(),
				instructionLimit,
				"[Additional focus truncated]\n",
			)
		: undefined;
	const fixedPromptTokens =
		estimateTextTokens(RESCUE_SYSTEM_PROMPT) +
		estimateTextTokens(buildRescuePrompt({ text: "" }, boundedInstructions));
	return {
		input: Math.max(
			0,
			contextWindow - output - fixedPromptTokens - PROMPT_SAFETY_MARGIN_TOKENS,
		),
		output,
		...(boundedInstructions ? { instructions: boundedInstructions } : {}),
	};
}

async function rescueSummary(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	config: RescueConfig,
	pending: PendingRescue,
): Promise<{
	summary: string;
	usage: Usage;
	details: { strategy: string; readFiles: string[]; modifiedFiles: string[] };
}> {
	const model = configuredModel(ctx, config);
	if (!model) {
		throw new Error(
			"No rescue model is available. Configure rescue.provider and rescue.model in settings.json",
		);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(`Rescue auth failed: ${auth.error}`);
	const provider = ctx.modelRegistry.getProvider(model.provider);
	if (!provider)
		throw new Error(`No provider is registered for ${model.provider}`);
	const budgets = rescueTokenBudgets(model, pending.instructions);

	const messages = [
		...event.preparation.messagesToSummarize,
		...event.preparation.turnPrefixMessages,
	];
	const conversation = buildRescueConversation(
		messages,
		event.preparation.previousSummary,
		budgets.input,
	);
	if (!conversation.text.trim())
		throw new Error("The session has no text that rescue can summarize");

	notify(ctx, `Rescue: summarizing with ${model.provider}/${model.id}`);

	const requestOptions: SimpleStreamOptions = {
		signal: event.signal,
		maxTokens: budgets.output,
		...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
		...(auth.headers ? { headers: auth.headers as ProviderHeaders } : {}),
		...(auth.env ? { env: auth.env } : {}),
		...(model.reasoning && config.reasoning !== "off"
			? { reasoning: config.reasoning }
			: {}),
	};

	const requestModel =
		provider.baseUrl && !model.baseUrl
			? { ...model, baseUrl: provider.baseUrl }
			: model;
	const response = await provider
		.streamSimple(
			requestModel,
			{
				systemPrompt: RESCUE_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: buildRescuePrompt(conversation, budgets.instructions),
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			requestOptions,
		)
		.result();

	if (response.stopReason === "error") {
		throw new Error(
			response.errorMessage || "The rescue model returned an error",
		);
	}

	const summary = response.content
		.filter(
			(part): part is { type: "text"; text: string } => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
	if (!summary) throw new Error("The rescue model returned an empty summary");
	const fileOps = fileOperationSummary(
		event.preparation.fileOps,
		Math.floor(budgets.output * 0.25),
	);
	const boundedSummary = truncateRescueText(
		summary,
		Math.max(1, budgets.output - estimateTextTokens(fileOps.text)),
	);

	return {
		summary: boundedSummary + fileOps.text,
		usage: response.usage,
		details: {
			strategy: "rescue",
			readFiles: fileOps.readFiles,
			modifiedFiles: fileOps.modifiedFiles,
		},
	};
}

export default function (pi: ExtensionAPI): void {
	let pending: PendingRescue | undefined;

	pi.on("session_before_compact", async (event, ctx) => {
		if (!pending) return;
		const request = pending;
		pending = undefined;

		let config: RescueConfig;
		try {
			config = readRescueConfig();
			const result = await rescueSummary(event, ctx, config, request);
			return {
				compaction: {
					summary: result.summary,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					usage: result.usage,
					details: result.details,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(ctx, message, "error");
			return { cancel: true };
		}
	});

	pi.registerCommand("rescue", {
		description: "Compact with a tool-free rescue summary",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const instructions = args.trim();
			pending = instructions ? { instructions } : {};
			notify(ctx, "Rescue compaction started");
			ctx.compact({
				onComplete: () => notify(ctx, "Rescue compaction completed"),
				onError: (error) => {
					pending = undefined;
					notify(ctx, `Rescue compaction failed: ${error.message}`, "error");
				},
			});
		},
	});
}
