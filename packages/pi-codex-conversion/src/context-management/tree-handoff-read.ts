import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { createHistoryNotesTools } from "./history-notes.ts";
import type { ResponsesToolCall } from "../providers/openai-responses/native-items.ts";

const READ_KEY = "codexContextNoteRead";
const READ_SCHEMA = Type.Object({
	protocol: Type.Literal(1), origin: Type.Literal("host"),
	id: Type.String({ pattern: "^[a-f0-9-]{36}$" }), path: Type.String({ minLength: 1 }),
	namespace: Type.Optional(Type.Literal("notes")),
	api: Type.String({ minLength: 1 }), provider: Type.String({ minLength: 1 }), model: Type.String({ minLength: 1 }),
	timestamp: Type.Number({ minimum: 0 }),
	content: Type.Array(Type.Union([
		Type.Object({ type: Type.Literal("text"), text: Type.String() }),
		Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String(),
			detail: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("high"), Type.Literal("original")])) }),
	])),
	details: Type.Object({ codexHistoryNotes: Type.Record(Type.String(), Type.Unknown()) }),
}, { additionalProperties: false });
type HandoffRead = Static<typeof READ_SCHEMA>;

function callId(id: string): string {
	const name = "tree_handoff_" + id.replaceAll("-", "");
	return `${name}|fc_${name}`;
}

function isJson(value: unknown): value is JsonValue {
	return value === null || typeof value === "string" || typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		(Array.isArray(value) ? value.every(isJson) : typeof value === "object" && Object.values(value).every(isJson));
}

/** Read once on the departing branch; Pi commits this receipt with the navigation. */
export async function readTreeHandoffNote(
	pi: ExtensionAPI, ctx: ExtensionContext, mode: ContextManagementMode, path: string, signal: AbortSignal,
): Promise<Record<string, unknown>> {
	const model = ctx.model;
	if (!model) throw new Error("No model selected for tree handoff");
	const id = randomUUID();
	const [, notes] = createHistoryNotesTools(pi, () => mode);
	const result = await notes.execute(callId(id), { action: "read_file", path }, signal, undefined, ctx);
	signal.throwIfAborted();
	const data = result.details.codexHistoryNotes;
	if (mode === "remote" ? typeof data["encrypted_output"] !== "string" || !data["encrypted_output"].trim()
		: !data["file"] || typeof data["file"] !== "object" || !("content" in data["file"]) || typeof data["file"].content !== "string")
		throw new Error("The handoff note could not be read. The jump was cancelled");
	const read: HandoffRead = { protocol: 1, origin: "host", id, path,
		...(mode === "remote" ? { namespace: "notes" as const } : {}),
		api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
		content: result.content, details: result.details };
	return { [READ_KEY]: read };
}

/** Expand only surviving summaries, after Pi compaction and window retirement. */
export function projectTreeHandoffReads(messages: readonly AgentMessage[], entries: readonly SessionEntry[]): AgentMessage[] {
	const summaries = new Map(entries.filter(entry => entry.type === "branch_summary")
		.map(entry => [JSON.stringify([entry.fromId, new Date(entry.timestamp).getTime()]), entry]));
	const calls = new Set(messages.flatMap(message => message.role === "assistant"
		? message.content.flatMap(part => part.type === "toolCall" ? [part.id] : []) : []));
	const results = new Set(messages.flatMap(message => message.role === "toolResult" ? [message.toolCallId] : []));
	return messages.flatMap((message): AgentMessage[] => {
		if (message.role !== "branchSummary") return [message];
		const details = summaries.get(JSON.stringify([message.fromId, message.timestamp]))?.details;
		if (!details || typeof details !== "object" || !(READ_KEY in details)) return [message];
		const read = details[READ_KEY];
		if (!Check(READ_SCHEMA, read)) throw new Error("Invalid persisted tree handoff read");
		const resultDetails = read.details;
		if (!isJson(resultDetails)) throw new Error("Invalid persisted tree handoff result");
		const id = callId(read.id);
		if (calls.has(id) !== results.has(id)) throw new Error("Incomplete tree handoff read in context");
		if (calls.has(id)) return [message];
		const call: ResponsesToolCall = { type: "toolCall", id, name: "notes", arguments: { action: "read_file", path: read.path },
			...(read.namespace ? { namespace: read.namespace, responsesNamespace: read.namespace } : {}) };
		return [message, {
			role: "assistant", api: read.api, provider: read.provider, model: read.model,
			content: [call],
			// This host operation has no generated tokens or provider response ID.
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse", timestamp: read.timestamp,
		}, {
			role: "toolResult", toolCallId: id, toolName: "notes", isError: false,
			content: read.content, details: resultDetails, timestamp: read.timestamp,
		}];
	});
}
