import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../activation/state.ts";
import { isNativeCompactionEntry } from "../compaction/types.ts";

/** Resolve checkpoint provenance from Pi's effective summary, never a Notes marker. */
export function captureNativeCompactionContext(messages: readonly AgentMessage[], ctx: ExtensionContext, state: AdapterState): void {
	state.replayCompaction = undefined;
	const summary = messages.find(message => message.role === "compactionSummary");
	if (!summary || summary.role !== "compactionSummary") return;
	const candidates = ctx.sessionManager.getEntries().filter(entry => isNativeCompactionEntry(entry)
		&& entry.summary === summary.summary && entry.tokensBefore === summary.tokensBefore
		&& new Date(entry.timestamp).getTime() === summary.timestamp);
	if (candidates.length > 1) throw new Error("The active native checkpoint has ambiguous session provenance; select its original branch before continuing");
	const entry = candidates[0];
	if (entry) state.replayCompaction = { sessionId: ctx.sessionManager.getSessionId(), entryId: entry.id };
}
