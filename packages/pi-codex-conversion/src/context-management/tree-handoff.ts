import { randomUUID } from "node:crypto";
import { contentText } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionBeforeTreeEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { createPiSessionNotesSnapshot } from "./local-notes.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE } from "./messages.ts";

/** Anchor the selected range in conversation content, not private Pi entry IDs. */
function summaryScope(branch: readonly SessionEntry[], firstSelectedId: string): string {
	const start = branch.findIndex((entry) => entry.id === firstSelectedId);
	if (start < 0) throw new Error("The selected conversation range is no longer on the current path");
	for (let index = start - 1; index >= 0; index--) {
		const entry = branch[index]!;
		if (entry.type === "branch_summary" || entry.type === "compaction")
			return `since the summary beginning ${JSON.stringify(entry.summary.slice(0, 240))}`;
		if (entry.type === "custom_message" && entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE) {
			const windowId = contentText(entry.content).match(/Current context window id: ([^\n]+)/)?.[1];
			if (windowId) return `since the start of context window ${windowId}`;
		}
		if (entry.type === "custom" && entry.customType === "codex-context-note" &&
			entry.data && typeof entry.data === "object" && "path" in entry.data && typeof entry.data.path === "string")
			return `since saving the note ${entry.data.path}`;
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = contentText(message.content).trim();
		if (text) return `since the ${message.role} message beginning ${JSON.stringify(text.slice(0, 240))}`;
		if (message.role === "assistant") {
			const write = message.content.findLast((part) => part.type === "toolCall" &&
				part.name === "notes" &&
				(part.arguments["action"] === "write_file" || part.arguments["action"] === "append_to_file"));
			if (write?.type === "toolCall" && typeof write.arguments["path"] === "string")
				return `since saving the note ${write.arguments["path"]}`;
		}
	}
	return "in this conversation so far";
}

interface PendingHandoff {
	sessionId: string;
	path: string;
	prompt: string;
	preparing: boolean;
	started: boolean;
	noteWritten: boolean;
	resolve: () => void;
	reject: (error: Error) => void;
}

/** Keep native navigation pending while the departing agent saves its handoff. */
export class CodexTreeHandoff {
	private pending: PendingHandoff | undefined;

	get active(): boolean { return this.pending !== undefined; }

	reset(): void {
		this.pending?.reject(new Error("Session changed during tree handoff"));
		this.pending = undefined;
	}

	preparing(prompt: string): void {
		if (!this.pending) return;
		if (prompt !== this.pending.prompt) {
			this.pending.reject(new Error("Another prompt interrupted the tree handoff"));
			return;
		}
		this.pending.preparing = true;
	}

	started(ctx: ExtensionContext): void {
		if (this.pending?.preparing && this.pending.sessionId === ctx.sessionManager.getSessionId())
			this.pending.started = true;
	}

	settled(ctx: ExtensionContext): void {
		if (this.pending?.started && this.pending.sessionId === ctx.sessionManager.getSessionId())
			this.pending.resolve();
	}

	finishNoteWrite(action: string, path: unknown, ctx: ExtensionContext): boolean {
		const pending = this.pending;
		if (!pending?.started || pending.sessionId !== ctx.sessionManager.getSessionId() ||
			path !== pending.path || (action !== "write_file" && action !== "append_to_file")) return false;
		pending.noteWritten = true;
		return true;
	}

	async prepare(
		pi: ExtensionAPI,
		event: SessionBeforeTreeEvent,
		ctx: ExtensionContext,
		mode: ContextManagementMode,
	) {
		if (this.pending) {
			ctx.ui.notify("A tree handoff is already in progress", "warning");
			return { cancel: true };
		}
		const sessionId = ctx.sessionManager.getSessionId();
		const sourceId = ctx.sessionManager.getLeafId();
		const path = `/root/notes/tree-handoff-${randomUUID()}`;
		const entries = event.preparation.entriesToSummarize;
		if (entries.length === 0) return;
		const prompt = [
			`Summarize what happened ${summaryScope(ctx.sessionManager.getBranch(), entries[0]!.id)} and save it in notes at ${path}.`,
			...(event.preparation.customInstructions?.trim() ? [event.preparation.customInstructions] : []),
		].join("\n\n");
		let startupTimer: ReturnType<typeof setTimeout> | undefined;
		const aborted = () => { ctx.abort(); };
		try {
			if (event.signal.aborted) return { cancel: true };
			const completed = Promise.withResolvers<void>();
			const pending: PendingHandoff = { sessionId, path, prompt, preparing: false, started: false, noteWritten: false,
				resolve: completed.resolve, reject: completed.reject };
			this.pending = pending;
			// Pi's sendUserMessage is fire-and-forget, including preflight errors.
			startupTimer = setTimeout(() => {
				if (!pending.started) completed.reject(new Error("Handoff agent did not start. Check model authentication and retry the jump"));
			}, 30_000);
			event.signal.addEventListener("abort", aborted, { once: true });
			ctx.ui.notify("Saving a note before tree navigation", "info");
			pi.sendUserMessage(prompt);
			await completed.promise;
			if (event.signal.aborted) return { cancel: true };
			const branch = ctx.sessionManager.getBranch();
			if (ctx.sessionManager.getSessionId() !== sessionId ||
				(sourceId && !branch.some((entry) => entry.id === sourceId)))
				throw new Error("The source branch changed during tree handoff");
			const last = branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (!pending.noteWritten || last?.type !== "message" || last.message.role !== "assistant" ||
				(last.message.stopReason !== "toolUse" && last.message.stopReason !== "stop"))
				throw new Error("Handoff agent did not finish successfully. The jump was cancelled");
			let details: Record<string, unknown> = {};
			if (mode !== "remote") {
				const snapshot = createPiSessionNotesSnapshot(branch, path);
				details = { codexContextNoteHandoff: snapshot };
			}
			if (event.signal.aborted) return { cancel: true };
			return { summary: {
				summary: `The user continued the conversation beyond this point. That discussion is summarized in a note. Before resuming, read it with notes.read_file using the exact path ${JSON.stringify(path)}.`,
				details,
			} };
		} catch (error) {
			ctx.ui.notify(`Tree handoff failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return { cancel: true };
		} finally {
			clearTimeout(startupTimer);
			event.signal.removeEventListener("abort", aborted);
			this.pending = undefined;
		}
	}
}
