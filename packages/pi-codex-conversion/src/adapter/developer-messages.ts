import { createHmac, randomBytes } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	customDeveloperMessageMetadata,
	isCodexDeveloperMessageDetails,
} from "../developer-messages.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE, isContextWindowBoundary, rewriteContextWindowGuidance } from "../context-management/messages.ts";
import { CODEX_REASONING_UPDATE_TYPE, codexReasoningLane, normalizeCodexConfigurationUpdates, readCodexReasoningUpdate, supportsCodexReasoningUpdates, type CodexReasoningUpdate } from "./reasoning-updates.ts";
import { CODEX_CURRENT_TIME_REMINDER_TYPE } from "./current-time-reminder.ts";
import { CODEX_TOOLKIT_UPDATE_TYPE } from "./code-mode/toolkit-updates.ts";
import { CODEX_NOTEBOOK_STATUS_TYPE } from "./notebook-status.ts";
import { REMOTE_DELIVERY_MESSAGE, REMOTE_DELIVERY_RECEIVER, readRemoteDelivery, remoteDeliveryItems, remoteDeliverySource, validateRemoteDelivery, type RemoteDelivery } from "../context-management/remote-delivery.ts";
import { assertRemoteDeliveryPairs, isEncryptedFunctionOutput, isOriginalExecCall } from "../context-management/remote-delivery-protocol.ts";
import { normalizeResponsesId } from "../providers/openai-responses/shared.ts";
import { prepareResponsesLiteConversationInput } from "../providers/openai-codex/responses-lite.ts";

/** Authenticated carrier through Pi's custom-message-to-user conversion. */
export class CodexDeveloperMessageBridge {
	private readonly secret = randomBytes(32);
	private carriers = new Map<string, string | CodexReasoningUpdate | RemoteDelivery>();
	private readonly contextWindowCarriers = new Set<string>();

	prepare(
		messages: readonly AgentMessage[],
		active: boolean,
		model?: Model<Api>,
	): AgentMessage[] {
		const execCalls = new Set(messages.flatMap(message => message.role === "assistant"
			? message.content.flatMap(part => part.type === "toolCall" && part.name === "exec" ? [part.id] : []) : []));
		const resultIds = new Set(messages.flatMap(message => message.role === "toolResult" ? [message.toolCallId] : []));
		const seen = new Set<string>();
		const projected: AgentMessage[] = [];
		for (const message of messages) {
			const customMetadata = message.role === "custom"
				? customDeveloperMessageMetadata(message.details) : undefined;
			if (
				message.role !== "custom" ||
				(message.customType !== CODEX_DEVELOPER_MESSAGE_TYPE &&
					message.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
					message.customType !== CODEX_CURRENT_TIME_REMINDER_TYPE &&
					message.customType !== CODEX_TOOLKIT_UPDATE_TYPE &&
					message.customType !== CODEX_NOTEBOOK_STATUS_TYPE &&
					message.customType !== REMOTE_DELIVERY_MESSAGE &&
					message.customType !== CODEX_REASONING_UPDATE_TYPE && customMetadata === undefined)
			) {
				projected.push(message);
				continue;
			}
			if (!active) {
				if (message.customType === CODEX_DEVELOPER_MESSAGE_TYPE || message.customType === CODEX_CURRENT_TIME_REMINDER_TYPE || message.customType === CODEX_TOOLKIT_UPDATE_TYPE || message.customType === CODEX_NOTEBOOK_STATUS_TYPE || customMetadata !== undefined)
					projected.push(message);
				continue;
			}
			const reasoningUpdate = customMetadata === undefined && message.customType === CODEX_REASONING_UPDATE_TYPE;
			let value: string | CodexReasoningUpdate | RemoteDelivery;
			let id: string;
			if (message.customType === REMOTE_DELIVERY_MESSAGE) {
				value = readRemoteDelivery(message.details);
				// Pi's selected compaction/window slice owns the cut. Never reconstruct a removed call.
				if (value.protocol === 2 && !execCalls.has(value.originalExecCallId)) continue;
				if (value.protocol === 2 && (!resultIds.has(value.originalExecCallId) || !resultIds.has(value.sourceCallId)))
					throw new Error("Remote output is missing its original receipt in the selected history");
				id = value.id;
			} else if (reasoningUpdate) {
				if (!model || !supportsCodexReasoningUpdates(model)) continue;
				value = readCodexReasoningUpdate(message.details);
				if (value.lane !== codexReasoningLane(model)) continue;
				id = value.id;
			} else {
				const metadata = customMetadata ?? message.details;
				if (typeof message.content !== "string" || message.content.trim() === "" || !isCodexDeveloperMessageDetails(metadata))
					throw new Error("Malformed persisted Codex developer message");
				value = message.content;
				id = metadata.id;
			}
			const marker = this.marker(id);
			if (seen.has(marker))
				throw new Error("Duplicate persisted Codex developer message");
			seen.add(marker);
			const existing = this.carriers.get(marker);
			if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value))
				throw new Error("Persisted Codex developer message changed content");
			this.carriers.set(marker, value);
			if (isContextWindowBoundary(message)) this.contextWindowCarriers.add(marker);
			projected.push({ ...message, content: marker });
		}
		return projected;
	}

	rewritePayload(payload: unknown, model?: Model<Api>, blockImages = false): unknown {
		if (this.carriers.size === 0) return payload;
		if (!isRecord(payload) || !Array.isArray(payload["input"])) {
			if (!containsCarrier(payload, this.carriers)) return payload;
			throw new Error(
				"Codex developer messages require a Responses input array",
			);
		}
		const matched = new Set<string>();
		let initialEffort: string | undefined;
		const input = payload["input"].flatMap((item) => {
			const marker = readCarrierMarker(item);
			if (!marker) return [item];
			const carrier = this.carriers.get(marker);
			if (!carrier) return [item];
			if (matched.has(marker))
				throw new Error("Codex developer message carrier was duplicated");
			matched.add(marker);
			if (typeof carrier !== "string" && "origin" in carrier)
				return remoteDeliveryItems({ ...carrier, images: model?.input.includes("image") === false ? [] : carrier.images }, blockImages);
			if (typeof carrier !== "string") {
				initialEffort ??= carrier.initialEffort;
				return [{ type: "configuration_update", reasoning: { effort: carrier.effort } }];
			}
			return [toDeveloperMessage(item, this.contextWindowCarriers.has(marker)
				? rewriteContextWindowGuidance(carrier, supportsCodexReasoningUpdates(model))
				: carrier)];
		});
		if (containsCarrier(input, this.carriers))
			throw new Error(
				"Codex developer message carrier reached an unsupported Responses shape",
			);
		if (!initialEffort) return { ...payload, input };
		return normalizeCodexConfigurationUpdates({ ...payload, input, reasoning: { ...(isRecord(payload["reasoning"]) ? payload["reasoning"] : {}), effort: initialEffort } });
	}

	clear(): void {
		this.carriers.clear();
		this.contextWindowCarriers.clear();
	}

	async validateRemotePayload(payload: unknown, account: () => string | undefined, ctx?: ExtensionContext, responsesLite = false, baseUrl?: string): Promise<void> {
		if (!isRecord(payload) || !Array.isArray(payload["input"])) return;
		assertRemoteDeliveryPairs(payload["input"]);
		await this.validateOriginalExecOutputs(payload["input"], account, ctx, responsesLite, baseUrl);
		const deliveries = new Map<string, RemoteDelivery>();
		for (const value of this.carriers.values())
			if (typeof value !== "string" && "origin" in value)
				deliveries.set("host_delivery_" + value.id.replaceAll("-", ""), value);
		// Native replay and compaction may already contain the pair rather than a prepared carrier.
		for (let index = 0; index < payload["input"].length; index++) {
			const item: unknown = payload["input"][index];
			if (!isRecord(item) || !(item["name"] === REMOTE_DELIVERY_RECEIVER ||
				typeof item["call_id"] === "string" && item["call_id"].startsWith("host_delivery_"))) continue;
			const callId = item["call_id"];
			if (typeof callId !== "string") throw new Error("Invalid Remote delivery pair");
			let delivery = deliveries.get(callId);
			if (!delivery && ctx) {
				const entry = ctx.sessionManager.getEntries().find(entry => entry.type === "custom_message" && entry.customType === REMOTE_DELIVERY_MESSAGE &&
					isRecord(entry.details) && typeof entry.details["id"] === "string" &&
					"host_delivery_" + entry.details["id"].replaceAll("-", "") === callId);
				if (entry?.type === "custom_message") delivery = readRemoteDelivery(entry.details);
			}
			if (!delivery) throw new Error("Remote delivery is missing its persisted provenance");
			if (!ctx) throw new Error("Remote delivery is missing its session context");
			const sourceName = remoteDeliverySource(delivery, ctx);
			const sourceId = normalizeResponsesId(delivery.sourceCallId.split("|")[0] ?? "");
			const sourceItems = payload["input"].flatMap((candidate, sourceIndex) =>
				isRecord(candidate) && candidate["call_id"] === sourceId ? [{ item: candidate, index: sourceIndex }] : []);
			const [sourceCall, sourceResult] = sourceItems;
			// Compacted slices may discard both source items. Their canonical ancestry still proves the actual operation.
			if (sourceItems.length && (sourceItems.length !== 2 || !sourceCall || !sourceResult || sourceCall.item["name"] !== sourceName ||
				!(sourceCall.item["type"] === "custom_tool_call" || sourceCall.item["type"] === "function_call") ||
				!(sourceResult.item["type"] === "custom_tool_call_output" || sourceResult.item["type"] === "function_call_output") ||
				sourceCall.index >= sourceResult.index || sourceResult.index >= index))
				throw new Error("Remote delivery precedes or mismatches its original call and result");
			let expected = remoteDeliveryItems(delivery);
			if (responsesLite && delivery.images.length) expected = await prepareResponsesLiteConversationInput(expected);
			const output: unknown = payload["input"][index + 1];
			if (JSON.stringify(item) !== JSON.stringify(expected[0]) || !isRecord(output) ||
				output["type"] !== "function_call_output" || output["call_id"] !== callId ||
				!sameRemoteOutput(output["output"], (expected[1] as { output: unknown }).output,
					(remoteDeliveryItems({ ...delivery, images: [] })[1] as { output: unknown }).output,
					(remoteDeliveryItems(delivery, true)[1] as { output: unknown }).output))
				throw new Error("Remote delivery pair changed content or order");
			validateRemoteDelivery(delivery, account, ctx, baseUrl);
			index++;
		}
	}

	private async validateOriginalExecOutputs(input: unknown[], account: () => string | undefined,
		ctx: ExtensionContext | undefined, responsesLite: boolean, baseUrl: string | undefined): Promise<void> {
		const originalIds = new Set(input.flatMap(call => isOriginalExecCall(call) ? [call["call_id"]] : []));
		if (!originalIds.size) return;
		const candidates = new Map<string, RemoteDelivery>();
		const required = new Set<string>();
		for (const value of this.carriers.values())
			if (typeof value !== "string" && "origin" in value && value.protocol === 2) candidates.set(value.id, value);
		for (const entry of ctx?.sessionManager.getBranch() ?? []) {
			if (entry.type !== "custom_message" || entry.customType !== REMOTE_DELIVERY_MESSAGE || !isRecord(entry.details) ||
				entry.details["protocol"] !== 2 || typeof entry.details["originalExecCallId"] !== "string") continue;
			const originalId = normalizeResponsesId(entry.details["originalExecCallId"].split("|")[0] ?? "");
			if (!originalIds.has(originalId)) continue;
			const value = readRemoteDelivery(entry.details);
			candidates.set(value.id, value);
			if (value.outputs.length) required.add(value.id);
		}
		const consumed = new Set<string>();
		for (const [index, item] of input.entries()) {
			if (!isEncryptedFunctionOutput(item)) continue;
			const call = input.find(candidate => isOriginalExecCall(candidate) && candidate["call_id"] === item["call_id"]);
			if (!call) continue; // Direct native encrypted function outputs retain their own route.
			if (!ctx) throw new Error("Remote delivery is missing its session context");
			let matched: RemoteDelivery | undefined;
			for (const delivery of candidates.values()) {
				if (delivery.protocol !== 2 || consumed.has(delivery.id) ||
					normalizeResponsesId(delivery.originalExecCallId.split("|")[0] ?? "") !== item["call_id"]) continue;
				let expected = remoteDeliveryItems(delivery);
				if (responsesLite && delivery.images.length) expected = await prepareResponsesLiteConversationInput(expected);
				if (sameRemoteOutput(item["output"], (expected[0] as { output?: unknown } | undefined)?.output,
					(remoteDeliveryItems({ ...delivery, images: [] })[0] as { output?: unknown } | undefined)?.output,
					(remoteDeliveryItems(delivery, true)[0] as { output?: unknown } | undefined)?.output)) {
					matched = delivery;
					break;
				}
			}
			if (!matched) throw new Error("Remote output changed content or is missing its persisted provenance");
			const sourceName = remoteDeliverySource(matched, ctx);
			const originalId = item["call_id"];
			const sourceId = normalizeResponsesId(matched.sourceCallId.split("|")[0] ?? "");
			const original = input.flatMap((candidate, at) => isRecord(candidate) && candidate["call_id"] === originalId &&
				(candidate["type"] === "custom_tool_call" || candidate["type"] === "custom_tool_call_output") ? [{ item: candidate, at }] : []);
			const [exec, receipt] = original;
			if (original.length !== 2 || !exec || !receipt || !isOriginalExecCall(exec.item) ||
				receipt.item["type"] !== "custom_tool_call_output" || exec.at >= receipt.at || receipt.at >= index)
				throw new Error("Remote output precedes or mismatches its original exec receipt");
			if (sourceName === "wait") {
				const witness = input.flatMap((candidate, at) => isRecord(candidate) && candidate["call_id"] === sourceId ? [{ item: candidate, at }] : []);
				const [wait, result] = witness;
				if (witness.length !== 2 || !wait || !result || wait.item["name"] !== "wait" || wait.item["type"] !== "function_call" ||
					result.item["type"] !== "function_call_output" || receipt.at >= wait.at || wait.at >= result.at || result.at >= index)
					throw new Error("Remote output precedes or mismatches its genuine wait receipt");
			}
			validateRemoteDelivery(matched, account, ctx, baseUrl);
			consumed.add(matched.id);
		}
		if ([...required].some(id => !consumed.has(id)))
			throw new Error("Remote exec output group was partially removed; trim the original call and all its outputs together");
	}

	private marker(id: string): string {
		const signature = createHmac("sha256", this.secret)
			.update(id)
			.digest("base64url");
		return "<pi-codex-developer-carrier:" + signature + ">";
	}
}

function sameRemoteOutput(actual: unknown, expected: unknown, withoutImages: unknown, blockedImages: unknown): boolean {
	// Exact protected text/cipher ordering, allowing only the owning image transform or text-only projection.
	return JSON.stringify(actual) === JSON.stringify(expected) || JSON.stringify(actual) === JSON.stringify(withoutImages) ||
		JSON.stringify(actual) === JSON.stringify(blockedImages);
}

function readCarrierMarker(value: unknown): string | undefined {
	if (!isRecord(value) || value["role"] !== "user") return undefined;
	const content = value["content"];
	if (typeof content === "string") return content;
	if (!Array.isArray(content) || content.length !== 1) return undefined;
	const part = content[0];
	return isRecord(part) &&
		part["type"] === "input_text" &&
		typeof part["text"] === "string"
		? part["text"]
		: undefined;
}

function toDeveloperMessage(value: unknown, content: string): unknown {
	if (!isRecord(value)) return value;
	if (typeof value["content"] === "string")
		return { ...value, role: "developer", content };
	const parts = value["content"];
	if (!Array.isArray(parts) || parts.length !== 1 || !isRecord(parts[0]))
		return value;
	return {
		...value,
		role: "developer",
		content: [{ ...parts[0], text: content }],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsCarrier(
	value: unknown,
	carriers: ReadonlyMap<string, unknown>,
): boolean {
	if (typeof value === "string") return carriers.has(value);
	if (Array.isArray(value))
		return value.some((item) => containsCarrier(item, carriers));
	if (!isRecord(value)) return false;
	return Object.values(value).some((item) => containsCarrier(item, carriers));
}
