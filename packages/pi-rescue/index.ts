import type { ProviderHeaders, Usage } from "@earendil-works/pi-ai";
import { completeSimple, type Model } from "@earendil-works/pi-ai/compat";
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
} from "./src/summary.js";

interface PendingRescue {
	instructions?: string;
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
): string {
	const modifiedFiles = [
		...new Set([...fileOps.written, ...fileOps.edited]),
	].sort();
	const modified = new Set(modifiedFiles);
	const readFiles = [...fileOps.read]
		.filter((file) => !modified.has(file))
		.sort();
	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(
			`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`,
		);
	}
	return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

async function rescueSummary(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	config: RescueConfig,
	pending: PendingRescue,
): Promise<{ summary: string; usage: Usage }> {
	const model = configuredModel(ctx, config);
	if (!model) {
		throw new Error(
			"No rescue model is available. Configure rescue.provider and rescue.model in settings.json",
		);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(`Rescue auth failed: ${auth.error}`);
	if (!auth.apiKey && !auth.headers && !auth.env)
		throw new Error(
			`No usable authentication is available for ${model.provider}/${model.id}`,
		);

	const messages = [
		...event.preparation.messagesToSummarize,
		...event.preparation.turnPrefixMessages,
	];
	const conversation = buildRescueConversation(
		messages,
		event.preparation.previousSummary,
	);
	if (!conversation.text.trim())
		throw new Error("The session has no text that rescue can summarize");

	notify(ctx, `Rescue: summarizing with ${model.provider}/${model.id}`);

	const requestOptions = {
		signal: event.signal,
		...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
		...(auth.headers ? { headers: auth.headers as ProviderHeaders } : {}),
		...(auth.env ? { env: auth.env } : {}),
		...(model.reasoning && config.reasoning !== "off"
			? { reasoning: config.reasoning }
			: {}),
	};

	const response = await completeSimple(
		model,
		{
			systemPrompt: RESCUE_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: buildRescuePrompt(conversation, pending.instructions),
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		requestOptions,
	);

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

	return {
		summary: summary + fileOperationSummary(event.preparation.fileOps),
		usage: response.usage,
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
					details: { strategy: "rescue" },
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
