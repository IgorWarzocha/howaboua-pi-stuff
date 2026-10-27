import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import {
	buildSessionProjection,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

const READ_KEY = "codexContextNoteRead";
const READ_SCHEMA = Type.Object(
	{
		protocol: Type.Literal(1),
		origin: Type.Literal("host"),
		id: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
		path: Type.String({ minLength: 1 }),
		namespace: Type.Optional(Type.Literal("notes")),
		api: Type.String({ minLength: 1 }),
		provider: Type.String({ minLength: 1 }),
		model: Type.String({ minLength: 1 }),
		timestamp: Type.Number({ minimum: 0 }),
		content: Type.Array(
			Type.Union([
				Type.Object({ type: Type.Literal("text"), text: Type.String() }),
				Type.Object({
					type: Type.Literal("image"),
					data: Type.String(),
					mimeType: Type.String(),
					detail: Type.Optional(
						Type.Union([
							Type.Literal("auto"),
							Type.Literal("high"),
							Type.Literal("original"),
						]),
					),
				}),
			]),
		),
		details: Type.Object({
			codexHistoryNotes: Type.Record(Type.String(), Type.Unknown()),
		}),
	},
	{ additionalProperties: false },
);

function callId(id: string): string {
	const name = "tree_handoff_" + id.replaceAll("-", "");
	return `${name}|fc_${name}`;
}

function isJson(value: unknown): value is JsonValue {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		(Array.isArray(value)
			? value.every(isJson)
			: typeof value === "object" && Object.values(value).every(isJson))
	);
}

/** Expand only surviving summaries, after Pi compaction and window retirement. */
export function projectTreeHandoffReads(
	messages: readonly AgentMessage[],
	entries: readonly SessionEntry[],
): AgentMessage[] {
	const summaries = new Map(
		entries
			.filter((entry) => entry.type === "branch_summary")
			.map((entry) => [
				JSON.stringify([entry.fromId, new Date(entry.timestamp).getTime()]),
				entry,
			]),
	);
	const calls = new Set(
		messages.flatMap((message) =>
			message.role === "assistant"
				? message.content.flatMap((part) =>
						part.type === "toolCall" ? [part.id] : [],
					)
				: [],
		),
	);
	const results = new Set(
		messages.flatMap((message) =>
			message.role === "toolResult" ? [message.toolCallId] : [],
		),
	);
	return messages.flatMap((message): AgentMessage[] => {
		if (message.role !== "branchSummary") return [message];
		const details = summaries.get(
			JSON.stringify([message.fromId, message.timestamp]),
		)?.details;
		if (!details || typeof details !== "object" || !(READ_KEY in details))
			return [message];
		const read = details[READ_KEY];
		if (!Check(READ_SCHEMA, read))
			throw new Error("Invalid persisted tree handoff read");
		const resultDetails = read.details;
		if (!isJson(resultDetails))
			throw new Error("Invalid persisted tree handoff result");
		const id = callId(read.id);
		if (calls.has(id) !== results.has(id))
			throw new Error("Incomplete tree handoff read in context");
		if (calls.has(id)) return [message];
		const call = {
			type: "toolCall" as const,
			id,
			name: "notes",
			arguments: { action: "read_file", path: read.path },
			...(read.namespace
				? { namespace: read.namespace, responsesNamespace: read.namespace }
				: {}),
		};
		return [
			message,
			{
				role: "assistant",
				api: read.api,
				provider: read.provider,
				model: read.model,
				content: [call],
				// This host operation has no generated tokens or provider response ID.
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: read.timestamp,
			},
			{
				role: "toolResult",
				toolCallId: id,
				toolName: "notes",
				isError: false,
				content: read.content,
				details: resultDetails,
				timestamp: read.timestamp,
			},
		];
	});
}

/** Compaction-only contributions: never append these entries to the session file.
 * IDs belong to the original summary; Pi's persisted kept boundary stays physical.
 */
export function projectTreeHandoffBranch(
	entries: readonly SessionEntry[],
): readonly SessionEntry[] {
	const projection = buildSessionProjection([...entries]);
	const expanded = projectTreeHandoffReads(projection.messages, entries);
	if (expanded.length === projection.messages.length) return entries;
	const additions = new Map<string, AgentMessage[]>();
	for (const entry of projection.entries) {
		if (entry.sourceEntry.type !== "branch_summary") continue;
		const message = entry.messages.find(
			(item) => item.role === "branchSummary",
		);
		if (!message) continue;
		const offset = expanded.indexOf(message);
		const next = projection.messages[projection.messages.indexOf(message) + 1];
		const end = next ? expanded.indexOf(next) : expanded.length;
		const inserted = expanded.slice(offset + 1, end);
		if (inserted.length) additions.set(entry.sourceEntry.id, inserted);
	}
	const ids = new Set(entries.map((entry) => entry.id));
	let parentId: string | null = null;
	return entries.flatMap((entry): SessionEntry[] => {
		const result: SessionEntry[] = [
			entry.parentId === parentId ? entry : { ...entry, parentId },
		];
		parentId = entry.id;
		for (const [index, message] of (additions.get(entry.id) ?? []).entries()) {
			const id = entry.id + ":notes-handoff:" + index;
			if (ids.has(id)) throw new Error("Conflicting tree handoff contribution");
			result.push({
				type: "message",
				id,
				parentId,
				timestamp: entry.timestamp,
				message,
			});
			parentId = id;
		}
		return result;
	});
}
