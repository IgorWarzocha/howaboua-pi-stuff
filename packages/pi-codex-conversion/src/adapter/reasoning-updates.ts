import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, type Api, type Model } from "@earendil-works/pi-ai";

export const CODEX_REASONING_UPDATE_TYPE = "codex-reasoning-update";
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export interface CodexReasoningUpdate {
	protocol: 1;
	id: string;
	lane: string;
	initialEffort: string;
	effort: string;
}

export function supportsCodexReasoningUpdates(model: Model<Api> | undefined): boolean {
	return model?.api === "openai-codex-responses" && model.id.split("/").at(-1)?.toLowerCase() === "gpt-6-astra";
}

export function codexReasoningLane(model: Model<Api>): string {
	return JSON.stringify([model.provider, model.api, model.id]);
}

export function readCodexReasoningUpdate(value: unknown): CodexReasoningUpdate {
	if (!value || typeof value !== "object"
		|| !("protocol" in value) || value.protocol !== 1
		|| !("id" in value) || typeof value.id !== "string" || !value.id
		|| !("lane" in value) || typeof value.lane !== "string" || !value.lane
		|| !("initialEffort" in value) || !validEffort(value.initialEffort)
		|| !("effort" in value) || !validEffort(value.effort)) {
		throw new Error("Malformed persisted Codex reasoning update");
	}
	return value as CodexReasoningUpdate;
}

function validEffort(value: unknown): value is string {
	return typeof value === "string" && ["low", "medium", "high", "xhigh", "max"].includes(value);
}

function effortForLevel(model: Model<Api>, level: ThinkingLevel): string {
	const clamped = clampThinkingLevel(model, level);
	const effort = model.thinkingLevelMap?.[clamped] ?? (clamped === "minimal" ? "low" : clamped);
	if (!validEffort(effort)) throw new Error(`Unsupported Astra reasoning effort: ${effort}`);
	return effort;
}

export function codexReasoningUpdates(messages: readonly AgentMessage[], model: Model<Api>): CodexReasoningUpdate[] {
	if (!supportsCodexReasoningUpdates(model)) return [];
	const lane = codexReasoningLane(model);
	return messages.flatMap((message) => {
		if (message.role !== "custom" || message.customType !== CODEX_REASONING_UPDATE_TYPE) return [];
		const update = readCodexReasoningUpdate(message.details);
		return update.lane === lane ? [update] : [];
	});
}

/** Record the selector change, not a replacement of earlier model-visible history. */
export function recordCodexReasoningUpdate(pi: ExtensionAPI, ctx: ExtensionContext, messages: readonly AgentMessage[], previousLevel?: ThinkingLevel): void {
	const model = ctx.model;
	if (!model || !supportsCodexReasoningUpdates(model)) return;
	const lane = codexReasoningLane(model);
	const updates = codexReasoningUpdates(messages, model);
	const effort = effortForLevel(model, pi.getThinkingLevel());
	// During streaming earlier selector records may still be queued by Pi.
	const previous = previousLevel ? effortForLevel(model, previousLevel) : updates.at(-1)?.effort;
	if (previous === undefined || previous === effort) return;
	pi.sendMessage<CodexReasoningUpdate>({
		customType: CODEX_REASONING_UPDATE_TYPE,
		content: `Reasoning effort: ${effort}`,
		display: false,
		details: { protocol: 1, id: randomUUID(), lane, initialEffort: updates[0]?.initialEffort ?? previous, effort },
	}, { triggerTurn: false });
}

export function hasPendingCodexReasoningUpdate(messages: readonly AgentMessage[]): boolean {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (message.role === "assistant") return false;
		if (message.role === "custom" && message.customType === CODEX_REASONING_UPDATE_TYPE) return true;
	}
	return false;
}

/** Run after replay too: native checkpoints can restore an update at the tail. */
export function normalizeCodexConfigurationUpdates<T extends { input: unknown[]; model?: string | undefined; [key: string]: unknown }>(body: T): T {
	const isUpdate = (item: unknown): boolean => Boolean(item && typeof item === "object" && "type" in item && item.type === "configuration_update");
	if (!body.input.some(isUpdate)) return body;
	// A model switch is a new lane; Astra-only configuration is not portable.
	if (body.model && body.model.split("/").at(-1)?.toLowerCase() !== "gpt-6-astra") return { ...body, input: body.input.filter((item) => !isUpdate(item)) };
	if (body["truncation"] === "auto" || (Array.isArray(body["context_management"]) && body["context_management"].length > 0)) {
		throw new Error("Astra reasoning updates cannot use automatic truncation or server automatic compaction; use an explicit compaction_trigger");
	}
	// Multiple selector presses before a response are one effective update.
	// Persisted records stay intact; never append adjacent native updates.
	const input: unknown[] = [];
	for (const item of body.input) {
		if (isUpdate(item) && isUpdate(input.at(-1))) input.pop();
		input.push(item);
	}
	return { ...body, input };
}
