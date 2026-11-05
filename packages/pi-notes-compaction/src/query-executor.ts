import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	contextAgentIdentity,
	contextAgentNames,
	contextStorageAgentName,
} from "./agent-identity.js";
import { useHistory } from "./history.js";
import type { HistorySearch } from "./history-search.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { noteResult } from "./note-result.js";
import { collectNotes, normalizeNoteParams, useNotes } from "./notes.js";
import { lookupNotes } from "./notes-lookup.js";
import {
	readSharedHistory,
	readSharedNotes,
	sharedNotesUnavailable,
} from "./shared-notes.js";
import type { NotesStore } from "./store.js";
import {
	prepareHistoryArguments,
	prepareNotesArguments,
	queryArguments,
	queryHelp,
	result,
} from "./tool-contracts.js";

export function createQueryExecutor(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
	search: HistorySearch,
	shared = false,
) {
	const assertActive = () => {
		if (!lifecycle.active && !shared)
			throw new Error(
				"Notes tools are inactive. Ask the user to check /notes.",
			);
	};
	async function notes(
		callId: string,
		input: unknown,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<unknown>> {
		input = prepareNotesArguments(input);
		const help = queryHelp("notes", input, lifecycle.gptPromptMode());
		if (help) return help;
		assertActive();
		const raw = queryArguments("notes", input);
		if (!shared) {
			try {
				const routed = await lifecycle.bridge?.route?.(
					{ namespace: "notes", params: raw },
					callId,
					ctx,
					signal,
				);
				if (routed) return routed;
			} catch (error) {
				signal?.throwIfAborted();
				if (!sharedNotesUnavailable(error)) throw error;
				const saved = await readSharedNotes(ctx, store, raw, signal);
				if (saved) return noteResult(saved);
				throw error;
			}
			const saved = await readSharedNotes(ctx, store, raw, signal);
			if (saved) return noteResult(saved);
		}
		const identity = contextAgentIdentity(ctx);
		const storageAgent = contextStorageAgentName(identity);
		const localRaw = { ...raw };
		for (const key of ["path", "prefix", "path_prefix"]) {
			const value = localRaw[key];
			if (typeof value !== "string") continue;
			const alias = contextAgentNames(identity).find(
				(name) =>
					value === `${name}/notes` || value.startsWith(`${name}/notes/`),
			);
			if (alias)
				localRaw[key] = `${identity.agentName}${value.slice(alias.length)}`;
		}
		const params = queryArguments(
			"notes",
			normalizeNoteParams(localRaw, lifecycle.agent(ctx)),
		);
		if (signal?.aborted) throw new Error("Note operation cancelled");
		const local = useNotes(
			pi,
			store,
			params,
			ctx,
			lifecycle.agent(ctx),
			lifecycle.windows.current?.currentWindowId ?? "",
			lifecycle.runId,
			shared,
		);
		if (
			params["action"] === "write_file" ||
			params["action"] === "append_to_file"
		)
			return {
				...noteResult(local),
				details: {
					...(shared
						? { codexHistoryNotes: {}, notesCompactionRouted: true }
						: {
								notesCompaction: {
									protocol: 1,
									saved: true,
									runId: lifecycle.runId,
								},
							}),
				},
			};
		const notes = collectNotes(store, ctx.sessionManager.getBranch());
		if (
			params["action"] === "read_file" &&
			notes.get(params["path"] as string)?.mode === "replace"
		)
			return noteResult(local);
		const prefix = String(params["prefix"] ?? params["path_prefix"] ?? "");
		const replacementsInScope =
			params["action"] !== "read_file" &&
			[...notes.values()].some(
				(note) => note.mode === "replace" && note.path.startsWith(prefix),
			);
		const remoteParams = { ...params };
		for (const field of ["path", "prefix", "path_prefix"])
			if (typeof remoteParams[field] === "string")
				remoteParams[field] =
					`${storageAgent}/notes${remoteParams[field] ? `/${remoteParams[field]}` : ""}`;
		return lookupNotes(
			pi,
			store,
			lifecycle,
			{ namespace: "notes", params: remoteParams },
			local,
			callId,
			ctx,
			signal,
			shared,
			replacementsInScope,
		);
	}
	async function history(
		callId: string,
		input: unknown,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<unknown>> {
		input = prepareHistoryArguments(input);
		const help = queryHelp("history", input, lifecycle.gptPromptMode());
		if (help) return help;
		assertActive();
		const params = queryArguments("history", input);
		if (!shared) {
			try {
				const routed = await lifecycle.bridge?.route?.(
					{ namespace: "history", params },
					callId,
					ctx,
					signal,
				);
				if (routed) return routed;
			} catch (error) {
				signal?.throwIfAborted();
				if (
					!sharedNotesUnavailable(error) &&
					!(
						error instanceof Error &&
						error.message ===
							"Counterpart history requires its live attached owner; native history is unchanged"
					)
				)
					throw error;
				const saved = await readSharedHistory(
					ctx,
					store,
					search,
					params,
					signal,
				);
				if (saved) return result(saved);
				throw error;
			}
			const saved = await readSharedHistory(ctx, store, search, params, signal);
			if (saved) return result(saved);
		}
		if (
			params["agent_name"] &&
			!contextAgentNames(contextAgentIdentity(ctx)).includes(
				String(params["agent_name"]),
			)
		)
			throw new Error(
				"That agent's Pi session history is unavailable on this machine. Restore access to its saved JSONL session, or omit agent_name to search this session.",
			);
		signal?.throwIfAborted();
		return result(
			await useHistory(
				ctx.sessionManager.getBranch(),
				params,
				ctx.sessionManager.getSessionId(),
				search,
				ctx.sessionManager.getEntries(),
				signal,
				shared,
			),
		);
	}
	return { notes, history };
}
