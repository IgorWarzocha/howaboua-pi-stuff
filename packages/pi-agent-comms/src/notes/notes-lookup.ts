import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	CachedResponse,
	LookupQuery,
	SerializedCachedResponse,
} from "./bridge.js";
import { queryKey } from "./bridge.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { noteResult, PROTECTED_NOTES_UNAVAILABLE } from "./note-result.js";
import { CACHE_RECEIPT, sessionRef, sourceSessionIds } from "./notes.js";
import type { NotesStore } from "./store.js";

export async function lookupNotes(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
	query: LookupQuery,
	local: Record<string, unknown>,
	callId: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	shared = false,
	replacementsInScope = false,
): Promise<AgentToolResult<unknown>> {
	let responses: readonly CachedResponse[] = store.cached(
		sourceSessionIds(ctx),
		query,
	);
	let state = responses.length ? "cache" : "unavailable";
	let lookupFailed = false;
	const bridge = lifecycle.bridge;
	if (bridge?.lookup) {
		let fetched: readonly CachedResponse[] | undefined;
		try {
			fetched = await bridge.lookup(query, ctx, signal);
		} catch (error) {
			if (signal?.aborted) throw error;
			lookupFailed = true;
		}
		if (signal?.aborted) throw new Error("Lookup cancelled");
		if (fetched) {
			try {
				store.cache(sessionRef(ctx), fetched);
			} catch {
				throw new Error(
					"Notes cache write failed. Retry when local storage is available.",
				);
			}
			if (fetched.length)
				pi.appendEntry(CACHE_RECEIPT, {
					protocol: 1,
					sessionId: ctx.sessionManager.getSessionId(),
				});
			const exact = fetched.filter(
				(response) => queryKey(response.query) === queryKey(query),
			);
			if (exact.length) {
				responses = exact;
				state = "live";
			}
		}
	}
	const canProject =
		shared ||
		(Boolean(bridge?.projectResult) && bridge?.canProject?.(ctx) !== false);
	if (responses.length && !canProject) state = "incompatible";
	const warnings: string[] = [];
	if (state === "incompatible") warnings.push(PROTECTED_NOTES_UNAVAILABLE);
	else if (state === "cache")
		warnings.push(
			"Using cached remote notes. May be outdated. Refresh when access returns.",
		);
	else if (lookupFailed)
		warnings.push(
			"Remote lookup failed. Local results only. Retry for remote notes.",
		);
	if (responses.length && canProject && replacementsInScope)
		warnings.push(
			"Remote matches may predate replacements. Read the note for the current version.",
		);
	const output = noteResult({
		...local,
		...(warnings.length ? { warnings } : {}),
	});
	if (shared)
		return {
			...output,
			details: {
				codexHistoryNotes: {},
				externalNotesResponses: responses.map(
					({ bytes, ...response }): SerializedCachedResponse => ({
						...response,
						bytesBase64: Buffer.from(bytes).toString("base64"),
					}),
				),
			},
		};
	if (responses.length && canProject && bridge?.projectResult) {
		try {
			return await bridge.projectResult(output, responses, callId, ctx, signal);
		} catch (error) {
			signal?.throwIfAborted();
			throw new Error(
				"Protected notes not delivered. Retry in a compatible Codex session.",
				{ cause: error },
			);
		}
	}
	return output;
}
