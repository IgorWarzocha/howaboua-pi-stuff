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
import { CACHE_RECEIPT, sessionRef, sourceSessionIds } from "./notes.js";
import type { NotesStore } from "./store.js";
import { result } from "./tool-contracts.js";

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
					"Notes lookup could not finish. Retry when local storage is available.",
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
	if (state === "incompatible")
		warnings.push(
			"Some notes cannot be read with this model. Available notes are shown; ask the user to select a compatible Codex model to read the rest.",
		);
	else if (state === "cache")
		warnings.push(
			"These results could not be refreshed and may be outdated. Retry when access is restored.",
		);
	else if (lookupFailed)
		warnings.push(
			"Some notes could not be retrieved. Available notes are shown; retry the lookup to check for missing results.",
		);
	if (responses.length && canProject && replacementsInScope)
		warnings.push(
			"Older matches may refer to replaced notes. Read a note before relying on its excerpt; read returns the current saved version.",
		);
	const output = result({ ...local, ...(warnings.length ? { warnings } : {}) });
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
		} catch {
			throw new Error(
				"Notes could not be displayed. Retry the lookup with a compatible Codex model.",
			);
		}
	}
	return output;
}
