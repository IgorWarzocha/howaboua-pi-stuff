import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { displayValue } from "./normalise.ts";

export interface ObservationOrigin {
	sessionId: string;
	cwd: string;
}

type Append = (
	ctx: ExtensionContext,
	type: string,
	data: object,
	origin?: ObservationOrigin,
) => boolean;
interface Started extends ObservationOrigin {
	entryId: string;
	rootId: string;
	parentId: string | undefined;
	arguments: string;
	sourceInfo: unknown;
}

function bounded(value: unknown): string {
	const bytes = Buffer.from(displayValue(value));
	return bytes.length <= 128 * 1024
		? bytes.toString()
		: `${bytes.subarray(0, 128 * 1024).toString()}\n[Observation truncated]`;
}

/** Public events retain nested results that Pi's session receipts omit. */
export function recordToolObservations(
	pi: ExtensionAPI,
	append: Append,
	onError: (ctx: ExtensionContext) => void,
): void {
	const started = new Map<string, Started>();
	pi.on("session_start", () => started.clear());
	pi.on("session_shutdown", () => started.clear());
	pi.on("tool_execution_start", (event, ctx) => {
		try {
			const parent = event.parentToolCallId
				? started.get(event.parentToolCallId)
				: undefined;
			let entry = ctx.sessionManager.getLeafEntry();
			if (!parent) {
				while (
					entry &&
					!(entry.type === "message" && entry.message.role === "assistant")
				)
					entry = entry.parentId
						? ctx.sessionManager.getEntry(entry.parentId)
						: undefined;
			}
			if (!parent && (!entry || event.parentToolCallId)) return;
			const origin: Started = {
				sessionId: parent?.sessionId ?? ctx.sessionManager.getSessionId(),
				cwd: parent?.cwd ?? ctx.sessionManager.getCwd(),
				entryId: parent?.entryId ?? entry?.id ?? "",
				rootId: parent?.rootId ?? event.toolCallId,
				parentId: event.parentToolCallId,
				arguments: event.parentToolCallId ? bounded(event.args) : "",
				sourceInfo:
					pi.getAllTools().find((tool) => tool.name === event.toolName)
						?.sourceInfo ?? null,
			};
			started.set(event.toolCallId, origin);
			append(
				ctx,
				"pi-observatory:tool",
				{
					version: 1,
					...origin,
					callId: event.toolCallId,
					name: event.toolName,
				},
				origin,
			);
		} catch {
			onError(ctx);
		}
	});
	pi.on("tool_execution_end", (event, ctx) => {
		const origin = started.get(event.toolCallId);
		if (!origin) return;
		try {
			append(
				ctx,
				"pi-observatory:tool",
				{
					version: 1,
					...origin,
					callId: event.toolCallId,
					name: event.toolName,
					...(event.parentToolCallId
						? { result: bounded(event.result), isError: event.isError }
						: {}),
					durationMs: event.durationMs,
				},
				origin,
			);
		} catch {
			onError(ctx);
		} finally {
			// Yielded Code/Notebook work can still start children after its outer call returns.
			// Retain only identity, not captured arguments, until this session ends.
			origin.arguments = "";
		}
	});
}
