import { createHmac, randomBytes } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	isCodexDeveloperMessageDetails,
} from "../developer-messages.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE } from "../context-management/messages.ts";

/** Authenticated carrier through Pi's custom-message-to-user conversion. */
export class CodexDeveloperMessageBridge {
	private readonly secret = randomBytes(32);
	private carriers = new Map<string, string>();

	prepare(
		messages: readonly AgentMessage[],
		active: boolean,
	): AgentMessage[] {
		const seen = new Set<string>();
		const projected: AgentMessage[] = [];
		for (const message of messages) {
			if (
				message.role !== "custom" ||
				(message.customType !== CODEX_DEVELOPER_MESSAGE_TYPE &&
					message.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE)
			) {
				projected.push(message);
				continue;
			}
			if (!active) continue;
			if (
				typeof message.content !== "string" ||
				message.content.trim() === "" ||
				!isCodexDeveloperMessageDetails(message.details)
			)
				throw new Error("Malformed persisted Codex developer message");
			const marker = this.marker(message.details.id);
			if (seen.has(marker))
				throw new Error("Duplicate persisted Codex developer message");
			seen.add(marker);
			const existing = this.carriers.get(marker);
			if (existing !== undefined && existing !== message.content)
				throw new Error("Persisted Codex developer message changed content");
			this.carriers.set(marker, message.content);
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
		const input = payload["input"].map((item) => {
			const marker = readCarrierMarker(item);
			if (!marker) return item;
			const carrier = this.carriers.get(marker);
			if (!carrier) return item;
			if (matched.has(marker))
				throw new Error("Codex developer message carrier was duplicated");
			matched.add(marker);
			return toDeveloperMessage(item, carrier);
		});
		if (containsCarrier(input, this.carriers))
			throw new Error(
				"Codex developer message carrier reached an unsupported Responses shape",
			);
		return { ...payload, input };
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
	carriers: ReadonlyMap<string, string>,
): boolean {
	if (typeof value === "string") return carriers.has(value);
	if (Array.isArray(value))
		return value.some((item) => containsCarrier(item, carriers));
	if (!isRecord(value)) return false;
	return Object.values(value).some((item) => containsCarrier(item, carriers));
}
