import {
	convertToLlm,
	type CustomMessageEntryDraft,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	normalizeContext,
	getInitialSystemMessage,
	getSystemMessageText,
	type Api,
	type Model,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { buildRequestBody } from "./request-body.ts";
import {
	applyResponsesLiteRequest,
	prepareResponsesLiteRequestImages,
} from "./responses-lite.ts";
import { responseInputsEqual } from "./websocket-continuation.ts";
import type { OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";
import { normalizeResponsesToolHistory } from "../openai-responses/tool-history.ts";
import {
	customDeveloperMessageMetadata,
	isCodexDeveloperMessageDetails,
} from "../../developer-messages.ts";
import {
	projectCodexDeveloperEntry,
	projectCodexDeveloperHistory,
} from "../../adapter/developer-history.ts";
import type { PrefixRetainedGuidance } from "../../prefix-rollover.ts";

function textItem(item: unknown, role: string, text: string): boolean {
	if (
		!item ||
		typeof item !== "object" ||
		!("role" in item) ||
		item.role !== role ||
		!("content" in item)
	)
		return false;
	const content = item.content;
	return (
		Array.isArray(content) &&
		content.length === 1 &&
		content[0]?.type === "input_text" &&
		content[0].text === text
	);
}

/** Identify exactly the persisted virtual notices that reached this request. */
export function visibleVirtualEntries(
	branch: readonly SessionEntry[],
	body: ResponsesBody,
): { entryId: string; content: string }[] | undefined {
	// Reasoning updates have a separate configuration encoding and retirement
	// policy; never treat them as ordinary developer messages.
	if (
		body.input.some(
			(item) =>
				item &&
				typeof item === "object" &&
				"type" in item &&
				item.type === "configuration_update",
		)
	)
		return;
	const sources = new Map<string, { entryId: string; content: string }>();
	for (const entry of branch) {
		if (entry.type !== "custom") continue;
		const projected = projectCodexDeveloperEntry(entry);
		if (
			projected === entry ||
			projected.type !== "custom_message" ||
			!isCodexDeveloperMessageDetails(projected.details) ||
			typeof projected.content !== "string"
		)
			continue;
		if (sources.has(projected.details.id)) return;
		sources.set(projected.details.id, {
			entryId: entry.id,
			content: projected.content,
		});
	}
	const used = new Set<number>();
	const selected: { entryId: string; content: string }[] = [];
	for (const message of projectCodexDeveloperHistory(branch)) {
		if (
			message.role !== "custom" ||
			!isCodexDeveloperMessageDetails(message.details)
		)
			continue;
		const source = sources.get(message.details.id);
		if (!source) continue;
		const indexes = body.input.flatMap((item, index) =>
			textItem(item, "developer", source.content) ? [index] : [],
		);
		if (indexes.length > 1 || (indexes.length === 1 && used.has(indexes[0]!)))
			return;
		if (indexes.length === 1) {
			used.add(indexes[0]!);
			selected.push(source);
		}
	}
	return selected;
}

/** Locate the exact current kickoff in the final request; ambiguity leaves it untouched. */
export async function projectPrefixRollover(
	model: Model<Api>,
	context: TranscriptContext,
	body: ResponsesBody,
	options: OpenAICodexStreamOptions,
	responsesLite: boolean,
	kickoff: Extract<AgentMessage, { role: "user" | "custom" }>,
	carrier: Extract<AgentMessage, { role: "custom" }>,
	recovery: CustomMessageEntryDraft & { content: string },
	guidance: readonly PrefixRetainedGuidance[],
	virtual: readonly { entryId: string; content: string }[],
): Promise<ResponsesBody | undefined> {
	const converted = convertToLlm([kickoff]);
	const expected = converted[0];
	if (converted.length !== 1 || expected?.role !== "user") return;
	const matches = context.messages.filter(
		(message) =>
			message.role === "user" &&
			message.timestamp === expected.timestamp &&
			responseInputsEqual([message.content], [expected.content]),
	);
	if (matches.length !== 1) return;
	let single = buildRequestBody(
		model,
		normalizeContext({ messages: matches }),
		options,
	);
	if (responsesLite) {
		single = applyResponsesLiteRequest(single);
		single = await prepareResponsesLiteRequestImages(single, options.sessionId);
	}
	const items = single.input.filter(
		(item) =>
			item &&
			typeof item === "object" &&
			"role" in item &&
			item.role === "user",
	);
	if (items.length !== 1) return;
	const matchingIndexes: number[] = [];
	for (const [index, item] of body.input.entries())
		if (responseInputsEqual([item], items)) matchingIndexes.push(index);
	if (matchingIndexes.length !== 1) return;
	const kickoffIndex = matchingIndexes[0]!;
	const first = body.input[0];
	const systemIndex =
		first &&
		typeof first === "object" &&
		"type" in first &&
		first.type === "additional_tools"
			? 1
			: 0;
	const system = getInitialSystemMessage(context.messages);
	if (
		!system ||
		!textItem(
			body.input[systemIndex],
			"developer",
			getSystemMessageText(system),
		)
	)
		return;
	const prefixEnd = systemIndex + 1;
	if (kickoffIndex <= prefixEnd) return;
	if (typeof carrier.content !== "string") return;
	const carrierMetadata = customDeveloperMessageMetadata(carrier.details);
	const recoveryMetadata = customDeveloperMessageMetadata(recovery.details);
	if (
		(carrierMetadata !== undefined &&
			!isCodexDeveloperMessageDetails(carrierMetadata)) ||
		(recoveryMetadata !== undefined &&
			!isCodexDeveloperMessageDetails(recoveryMetadata))
	)
		return;
	const carrierRole = carrierMetadata === undefined ? "user" : "developer";
	const recoveryRole = recoveryMetadata === undefined ? "user" : "developer";
	const carrierIndexes: number[] = [];
	for (const [index, item] of body.input.entries()) {
		if (textItem(item, carrierRole, carrier.content))
			carrierIndexes.push(index);
	}
	if (carrierIndexes.length !== 1) return;
	const carrierIndex = carrierIndexes[0]!;
	if (carrierIndex >= kickoffIndex) return;
	let lastGuide = -1;
	const known = new Set<string>();
	for (const guide of guidance) {
		const content =
			guide.kind === "foreign"
				? guide.message.content
				: virtual.find((entry) => entry.entryId === guide.entryId)?.content;
		if (typeof content !== "string" || known.has(content)) return;
		known.add(content);
		const indexes = body.input.flatMap((item, index) =>
			textItem(item, "developer", content) ? [index] : [],
		);
		if (
			indexes.length !== 1 ||
			indexes[0]! < prefixEnd ||
			indexes[0]! <= lastGuide ||
			indexes[0]! >= kickoffIndex
		)
			return;
		lastGuide = indexes[0]!;
	}
	const oldCarrier = body.input[carrierIndex];
	if (
		!oldCarrier ||
		typeof oldCarrier !== "object" ||
		!("content" in oldCarrier) ||
		!Array.isArray(oldCarrier.content)
	)
		return;
	const recoveryItem = {
		...oldCarrier,
		role: recoveryRole,
		content: [{ ...oldCarrier.content[0], text: recovery.content }],
	};
	const kept: unknown[] = [];
	for (let index = prefixEnd; index < kickoffIndex; index++) {
		const item = body.input[index];
		if (!item || typeof item !== "object") continue;
		if (index === carrierIndex) continue;
		if (
			"role" in item &&
			item.role === "developer" &&
			![...known].some((content) => textItem(item, "developer", content))
		)
			return;
		if ("role" in item && item.role === "developer") kept.push(item);
		else if (
			"type" in item &&
			(item.type === "additional_tools" ||
				item.type === "configuration_update" ||
				item.type === "tool_search_call" ||
				item.type === "tool_search_output")
		)
			return;
	}
	const input = [
		...body.input
			.slice(0, prefixEnd)
			.filter((_, index) => index !== carrierIndex),
		...kept,
		recoveryItem,
		...body.input.slice(kickoffIndex),
	];
	// Never send a cut that would need tool-call or protected-output repair.
	if (!responseInputsEqual(input, normalizeResponsesToolHistory(input))) return;
	return { ...body, input };
}
