import { createHmac, randomBytes } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	customDeveloperMessageMetadata,
	isCodexDeveloperMessageDetails,
} from "../developer-messages.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE } from "../context-management/messages.ts";
import { CODEX_REASONING_UPDATE_TYPE, codexReasoningLane, normalizeCodexConfigurationUpdates, readCodexReasoningUpdate, supportsCodexReasoningUpdates, type CodexReasoningUpdate } from "./reasoning-updates.ts";

/** Authenticated carrier through Pi's custom-message-to-user conversion. */
export class CodexDeveloperMessageBridge {
	private readonly secret = randomBytes(32);
	private carriers = new Map<string, string | CodexReasoningUpdate>();

	prepare(
		messages: readonly AgentMessage[],
		active: boolean,
		model?: Model<Api>,
	): AgentMessage[] {
		const seen = new Set<string>();
		const projected: AgentMessage[] = [];
		for (const message of messages) {
			const customMetadata = message.role === "custom"
				? customDeveloperMessageMetadata(message.details) : undefined;
			if (
				message.role !== "custom" ||
				(message.customType !== CODEX_DEVELOPER_MESSAGE_TYPE &&
					message.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
					message.customType !== CODEX_REASONING_UPDATE_TYPE && customMetadata === undefined)
			) {
				projected.push(message);
				continue;
			}
			if (!active) {
				if (message.customType === CODEX_DEVELOPER_MESSAGE_TYPE || customMetadata !== undefined)
					projected.push(message);
				continue;
			}
			const reasoningUpdate = customMetadata === undefined && message.customType === CODEX_REASONING_UPDATE_TYPE;
			let value: string | CodexReasoningUpdate;
			let id: string;
			if (reasoningUpdate) {
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
			projected.push({ ...message, content: marker });
		}
		return projected;
	}

	rewritePayload(payload: unknown): unknown {
		if (this.carriers.size === 0) return payload;
		if (!isRecord(payload) || !Array.isArray(payload["input"])) {
			if (!containsCarrier(payload, this.carriers)) return payload;
			throw new Error(
				"Codex developer messages require a Responses input array",
			);
		}
		const matched = new Set<string>();
		let initialEffort: string | undefined;
		const input = payload["input"].map((item) => {
			const marker = readCarrierMarker(item);
			if (!marker) return item;
			const carrier = this.carriers.get(marker);
			if (!carrier) return item;
			if (matched.has(marker))
				throw new Error("Codex developer message carrier was duplicated");
			matched.add(marker);
			if (typeof carrier !== "string") {
				initialEffort ??= carrier.initialEffort;
				return { type: "configuration_update", reasoning: { effort: carrier.effort } };
			}
			return toDeveloperMessage(item, carrier);
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
	}

	private marker(id: string): string {
		const signature = createHmac("sha256", this.secret)
			.update(id)
			.digest("base64url");
		return "<pi-codex-developer-carrier:" + signature + ">";
	}
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
