import {
	getSystemMessageText,
	renderSystemMessageUpdate,
	resolveTranscript,
	resolveTranscriptTools,
	type Api,
	type Message,
	type Model,
	type SystemMessage,
	type Tool,
	type TranscriptContext,
	type Usage,
} from "@earendil-works/pi-ai";
import type {
	ResponseCreateParamsStreaming,
	ResponseInput,
	ResponseInputItem,
	ResponseToolSearchOutputItemParam,
	Tool as OpenAITool,
} from "openai/resources/responses/responses.js";
import {
	getJsonSchemaToolParameters,
	getGrammarToolInput,
	resolveGrammarConstrainedSampling,
	resolveJsonSchemaStrictSampling,
} from "../constrained-sampling.js";
import { parseTextSignature, shortHash } from "./signatures.ts";
import { normalizeResponsesToolHistory } from "./tool-history.ts";
import { normalizeResponsesMessageHistory } from "./message-history.ts";
import { encryptedToolOutputFromDetails, imageDetailForResponses, isImageGenerationCallBlock, isWebSearchCallBlock, sanitizeImageGenerationCallItem, sanitizeWebSearchCallItem, type ImageDetail, type ImageGenerationCallBlock, type WebSearchCallBlock } from "./native-items.ts";
import { unrouteContextNamespaceToolCall } from "../../context-management/namespace-tools.ts";

type InternalAssistantContent = Extract<Message, { role: "assistant" }>["content"][number] | ImageGenerationCallBlock | WebSearchCallBlock;
type ImageContentWithDetail = { type: "image"; data: string; mimeType: string; detail?: ImageDetail | undefined };

export interface OpenAIResponsesStreamOptions {
	serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
	grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
	resolveServiceTier?: (
		responseServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
		requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	) => ResponseCreateParamsStreaming["service_tier"] | undefined;
	applyServiceTierPricing?: (usage: Usage, serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined) => void;
	onOutputItemDone?: (item: unknown) => void;
}

interface ConvertResponsesMessagesOptions {
	includeSystemPrompt?: boolean | undefined;
	grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
	supportsMidConvoSystemMessages?: boolean | undefined;
	supportsAdditionalTools?: boolean | undefined;
	supportsToolSearch?: boolean | undefined;
	toolOptions?: ConvertResponsesToolsOptions | undefined;
}

interface ConvertResponsesToolsOptions {
	strict?: boolean | null | undefined;
	supportsStrictMode?: boolean | undefined;
	supportsOpenAIGrammarTools?: boolean | undefined;
	toolSearchResult?: boolean | undefined;
}

export const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function parseResponsesThinkingSignature(signature: string): ResponseInput[number] | undefined {
	try {
		return JSON.parse(signature) as ResponseInput[number];
	} catch {
		return undefined;
	}
}

export function convertResponsesMessages<TApi extends Api>(
	model: Model<TApi>,
	context: TranscriptContext,
	allowedToolCallProviders: ReadonlySet<string>,
	options?: ConvertResponsesMessagesOptions,
): ResponseInput {
	const normalizedContext = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
	const messages: ResponseInput = [];
	const normalizeIdPart = (part: string) => {
		const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
		const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
		return normalized.replace(/_+$/, "");
	};
	const buildForeignResponsesItemId = (itemId: string) => {
		const normalized = `fc_${shortHash(itemId)}`;
		return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
	};
	const normalizeToolCallId = (id: string, _targetModel: Model<TApi>, source: Extract<Message, { role: "assistant" }>) => {
		if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);
		if (!id.includes("|")) return normalizeIdPart(id);
		const [callId, itemId] = id.split("|") as [string, string | undefined];
		const normalizedCallId = normalizeIdPart(callId);
		const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
		let normalizedItemId = isForeignToolCall ? buildForeignResponsesItemId(itemId ?? "") : normalizeIdPart(itemId ?? "");
		if (!normalizedItemId.startsWith("fc_")) normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
		return `${normalizedCallId}|${normalizedItemId}`;
	};

	const transformedMessages = normalizeResponsesMessageHistory(normalizedContext.messages, model as Model<Api>, normalizeToolCallId as never);
	const transcriptTools = resolveTranscriptTools(
		normalizedContext.messages,
		(options?.supportsAdditionalTools ?? false) || (options?.supportsToolSearch ?? false),
	);
	const anchoredToolNames = new Set<string>();
	if (transcriptTools.anchorsAdditions) {
		for (let index = 1; index < normalizedContext.messages.length; index++) {
			const message = normalizedContext.messages[index];
			if (message?.role !== "system") continue;
			for (const tool of message.toolsAdded ?? []) anchoredToolNames.add(tool.name);
		}
	}
	const appendSystemToolAdditions = (message: SystemMessage, seed: string): void => {
		const tools = transcriptTools.anchorsAdditions ? (message.toolsAdded ?? []) : [];
		if (tools.length === 0) return;
		if (options?.supportsAdditionalTools) {
			messages.push({
				type: "additional_tools",
				role: "developer",
				tools: convertResponsesTools(tools, options.toolOptions),
			} satisfies ResponseInputItem);
			return;
		}
		if (!options?.supportsToolSearch) return;
		const names = tools.map((tool) => tool.name);
		const searchCallId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;
		messages.push({
			type: "tool_search_call",
			call_id: searchCallId,
			execution: "client",
			status: "completed",
			arguments: { query: names.join(" "), limit: names.length },
		} satisfies ResponseInputItem);
		messages.push({
			type: "tool_search_output",
			call_id: searchCallId,
			execution: "client",
			status: "completed",
			tools: convertResponsesTools(tools, { ...options.toolOptions, toolSearchResult: true }),
		} satisfies ResponseToolSearchOutputItemParam);
	};
	const includeSystemPrompt = options?.includeSystemPrompt ?? true;
	const compat = model.compat as { supportsDeveloperRole?: boolean | undefined } | undefined;
	const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";

	let msgIndex = 0;
	let sourceIndex = 0;
	for (const msg of transformedMessages) {
		const isLeadingSystemMessage = sourceIndex++ === 0 && msg.role === "system";
		if (msg.role === "system") {
			if (!isLeadingSystemMessage) appendSystemToolAdditions(msg, `system:${msgIndex}`);
			if (!isLeadingSystemMessage || includeSystemPrompt) {
				const text = isLeadingSystemMessage ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);
				if (text.length > 0) messages.push({ role: instructionRole, content: sanitizeSurrogates(text) });
			}
		} else if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({ role: "user", content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }] });
			} else {
				const content = msg.content.map((item) =>
					item.type === "text"
						? { type: "input_text" as const, text: sanitizeSurrogates(item.text) }
						: { type: "input_image" as const, detail: imageDetailForResponses(item), image_url: `data:${item.mimeType};base64,${item.data}` },
				);
				if (content.length > 0) messages.push({ role: "user", content });
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];
			const isSameProviderAndApi = msg.provider === model.provider && msg.api === model.api;
			const isSameModel = isSameProviderAndApi && msg.model === model.id;
			const isDifferentModel = isSameProviderAndApi && msg.model !== model.id;
			let textBlockIndex = 0;
			for (const block of msg.content as InternalAssistantContent[]) {
				if (isImageGenerationCallBlock(block)) {
					const imageGenerationCall = sanitizeImageGenerationCallItem(block.item);
					if (imageGenerationCall) output.push(imageGenerationCall as ResponseInput[number]);
				} else if (isWebSearchCallBlock(block)) {
					const webSearchCall = sanitizeWebSearchCallItem(block.item);
					if (webSearchCall) output.push(webSearchCall as ResponseInput[number]);
				} else if (block.type === "thinking") {
					const thinkingItem = block.thinkingSignature ? parseResponsesThinkingSignature(block.thinkingSignature) : undefined;
					if (thinkingItem) output.push(thinkingItem);
				} else if (block.type === "text") {
					const parsedSignature = parseTextSignature(block.textSignature);
					const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
					textBlockIndex++;
					let msgId = parsedSignature?.id ?? fallbackMessageId;
					if (msgId.length > 64) msgId = `msg_${shortHash(msgId)}`;
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] }],
						status: "completed",
						id: msgId,
						...(parsedSignature?.phase ? { phase: parsedSignature.phase } : {}),
					});
				} else if (block.type === "toolCall") {
					const wireCall = unrouteContextNamespaceToolCall(block);
					const [callId, itemIdRaw] = block.id.split("|");
					const customInputProperty = options?.grammarToolInputProperties?.get(block.name);
					let itemId: string | undefined = itemIdRaw;
					if (customInputProperty !== undefined && itemId?.startsWith("fc_")) {
						itemId = `ctc_${itemId.slice(3)}`;
					}
					if (
						(isDifferentModel && itemId?.startsWith("fc_"))
						|| (customInputProperty === undefined && !itemId?.startsWith("fc_"))
					) itemId = undefined;
					const canReplayNamespace = isSameModel || anchoredToolNames.has(block.name);
					output.push(customInputProperty === undefined
						? {
								type: "function_call",
								...(itemId ? { id: itemId } : {}),
								call_id: callId,
								name: wireCall.name,
								arguments: JSON.stringify(wireCall.arguments),
								...(canReplayNamespace && block.namespace !== undefined ? { namespace: block.namespace } : {}),
							} as ResponseInput[number]
						: {
								type: "custom_tool_call",
								...(itemId ? { id: itemId } : {}),
								call_id: callId,
								name: wireCall.name,
								input: sanitizeSurrogates(getGrammarToolInput(block.name, wireCall.arguments, customInputProperty)),
								...(canReplayNamespace && block.namespace !== undefined ? { namespace: block.namespace } : {}),
							} as ResponseInput[number]);
				}
			}
			if (output.length > 0) messages.push(...output);
		} else if (msg.role === "toolResult") {
			const textResult = msg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
			const hasImages = msg.content.some((c) => c.type === "image");
			const hasText = textResult.length > 0;
			const [callId] = msg.toolCallId.split("|");
			const encryptedToolOutput = encryptedToolOutputFromDetails(msg.details);
			const output = encryptedToolOutput
				? [
						{ type: "encrypted_content" as const, encrypted_content: encryptedToolOutput },
						...(hasImages && model.input.includes("image")
							? msg.content
									.filter((block): block is ImageContentWithDetail => block.type === "image")
									.map((block) => ({
										type: "input_image" as const,
										detail: imageDetailForResponses(block),
										image_url: `data:${block.mimeType};base64,${block.data}`,
									}))
							: []),
					]
				: hasImages && model.input.includes("image")
					? [
							...(hasText ? [{ type: "input_text" as const, text: sanitizeSurrogates(textResult) }] : []),
							...msg.content
								.filter((block): block is ImageContentWithDetail => block.type === "image")
								.map((block) => ({
									type: "input_image" as const,
									detail: imageDetailForResponses(block),
									image_url: `data:${block.mimeType};base64,${block.data}`,
								})),
						]
					: sanitizeSurrogates(hasText ? textResult : "(see attached image)");
			messages.push({
				type: options?.grammarToolInputProperties?.has(msg.toolName)
					? "custom_tool_call_output"
					: "function_call_output",
				call_id: callId!,
				output: output as any,
			} as ResponseInput[number]);
		}
		msgIndex++;
	}

	return normalizeResponsesToolHistory(messages) as ResponseInput;
}

export function convertResponsesTools(tools: readonly Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[] {
	const defaultStrict = options?.strict === undefined ? false : options.strict;
	const supportsStrictMode = options?.supportsStrictMode ?? true;
	const supportsOpenAIGrammarTools = options?.supportsOpenAIGrammarTools ?? false;
	return tools.map((tool): OpenAITool => {
		const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
		if (grammar) return {
			type: "custom",
			name: tool.name,
			description: tool.description,
			format: {
				type: "grammar",
				syntax: grammar.format,
				definition: grammar.definition,
			},
			...(options?.toolSearchResult ? { defer_loading: true } : {}),
		} as OpenAITool;
		const constrainedStrict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
		const strict = constrainedStrict ?? defaultStrict;
		const functionTool = {
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters: getJsonSchemaToolParameters(tool, strict === true) as unknown as Record<string, unknown>,
			...(options?.toolSearchResult ? { defer_loading: true } : {}),
		} as Extract<OpenAITool, { type: "function" }>;
		if (supportsStrictMode) functionTool.strict = strict;
		return functionTool;
	});
}


export { processResponsesStream } from "./stream.ts";
