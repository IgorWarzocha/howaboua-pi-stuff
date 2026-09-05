import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AskPrompt, PendingAsk } from "./contracts.js";
import { normalizeAskInput } from "./normalize.js";

export const PENDING_ASK_ENTRY_TYPE = "pi-ask-pending";

export type PendingAskUpdate =
	| { version: 1; state: "pending"; id: string; prompts: AskPrompt[] }
	| { version: 1; state: "closed"; id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parsePendingAskUpdate(value: unknown): PendingAskUpdate | undefined {
	if (!isRecord(value) || value["version"] !== 1) return undefined;
	const id = typeof value["id"] === "string" ? value["id"].trim() : "";
	if (!id) return undefined;
	if (value["state"] === "closed") return { version: 1, state: "closed", id };
	if (value["state"] !== "pending") return undefined;
	const { prompts } = normalizeAskInput({ prompts: value["prompts"] });
	if (prompts.length === 0) return undefined;
	return { version: 1, state: "pending", id, prompts };
}

export function readPendingAsks(
	entries: readonly SessionEntry[],
): PendingAsk[] {
	const pending = new Map<string, PendingAsk>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== PENDING_ASK_ENTRY_TYPE)
			continue;
		const update = parsePendingAskUpdate(entry.data);
		if (!update) continue;
		if (update.state === "closed") pending.delete(update.id);
		else pending.set(update.id, { id: update.id, prompts: update.prompts });
	}
	return [...pending.values()];
}
