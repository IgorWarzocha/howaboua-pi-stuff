import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../adapter/activation/state.ts";
import type { CodexExtensionRuntime } from "../extension/runtime.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { BRIDGE_CHANNEL, OWNER_CHANNEL, TOOL_NAMES, type NotesBridge, type NotesOwner } from "./external-notes-protocol.ts";

/** Discover before initialization and policy rewrites, in either extension order. */
export function discoverExternalNotesOwner(pi: ExtensionAPI, state: AdapterState): void {
	let found: NotesOwner | undefined;
	pi.events.emit(OWNER_CHANNEL, {
		protocol: 1,
		reply(owner: NotesOwner) {
			if (owner?.protocol !== 1 || owner.owner !== "pi-notes-compaction"
				|| typeof owner.identity !== "function" || typeof owner.projectMessages !== "function"
				|| typeof owner.projectBranch !== "function") throw new Error("Unsupported notes owner");
			if (found && found !== owner) throw new Error("Multiple notes owners responded");
			found = owner;
		},
	});
	if (found) {
		const result = state.externalNotesBridge?.claim(found);
		if (result && !result.claimed) throw new Error(result.reason);
	}
}

export function registerExternalNotesBridge(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	codeMode: CodeModeRegistration,
	capabilities: Omit<NotesBridge, "protocol" | "claim" | "beforeWindow">,
): () => void {
	const { state } = runtime;
	const registerTools: Extract<ReturnType<NotesBridge["claim"]>, { claimed: true }>["registerTools"] = (tools, ctx) => {
		if (!state.externalNotes) throw new Error("Notes ownership must be claimed before registration");
		if (tools.length !== TOOL_NAMES.length || TOOL_NAMES.some(name => tools.filter(tool => tool.name === name).length !== 1))
			throw new Error("Notes takeover requires all four continuity tools");
		for (const tool of tools) pi.registerTool(tool);
		state.externalNotes.tools = [...tools];
		state.availableToolNames = pi.getAllTools().map(tool => tool.name);
		if (state.externalNotes.contracts) capabilities.configureTools?.(tools, ctx, state.externalNotes.contracts);
	};
	const bridge: NotesBridge = {
		...capabilities,
		protocol: 1,
		claim(owner) {
			if (owner?.protocol !== 1 || owner.owner !== "pi-notes-compaction"
				|| typeof owner.identity !== "function" || typeof owner.projectMessages !== "function"
				|| typeof owner.projectBranch !== "function") return { claimed: false, reason: "Unsupported notes owner" };
			if (state.externalNotes && state.externalNotes.owner !== owner)
				return { claimed: false, reason: "Notes continuity already has an external owner" };
			if (!state.externalNotes) {
				state.contextWindows.reset();
				state.contextKickoff.reset();
				state.contextTree.reset();
				state.externalNotes = { owner };
			}
			return { claimed: true, registerTools };
		},
		async beforeWindow(ctx, signal) {
			signal?.throwIfAborted();
			await codeMode.checkpointNotebook();
			signal?.throwIfAborted();
			runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
			state.notebookStatusMessageId = undefined;
		},
	};
	state.externalNotesBridge = bridge;
	const unregister = pi.events.on(BRIDGE_CHANNEL, request => {
		if (request && typeof request === "object" && "protocol" in request && request.protocol === 1
			&& "reply" in request && typeof request.reply === "function") request.reply(bridge);
	});
	const dispose = () => {
		unregister();
		if (state.externalNotesBridge === bridge) state.externalNotesBridge = undefined;
	};
	try {
		discoverExternalNotesOwner(pi, state);
		return dispose;
	} catch (error) {
		dispose();
		throw error;
	}
}
