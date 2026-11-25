import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	isCodexDeveloperMessageDetails,
	type CodexDeveloperMessageDetails,
} from "../developer-messages.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { EXECUTION_MODE_LABELS } from "./activation/execution-mode.ts";
import type { AdapterState } from "./activation/state.ts";

export const BINDING_STATUS_TYPES = {
	ts: "codex-notebook-status",
	vm: "vm-binding-status",
} as const;

export type BindingStatusKind = keyof typeof BINDING_STATUS_TYPES;

export function isBindingStatusType(customType: string): boolean {
	return (
		customType === BINDING_STATUS_TYPES.ts ||
		customType === BINDING_STATUS_TYPES.vm
	);
}

interface BindingStatus extends CodexDeveloperMessageDetails {
	content: string;
	title: string;
}

export function readBindingStatus(value: unknown): BindingStatus {
	if (
		!isCodexDeveloperMessageDetails(value) ||
		!("content" in value) ||
		typeof value.content !== "string" ||
		!value.content.trim() ||
		!("title" in value) ||
		typeof value.title !== "string" ||
		!value.title.trim()
	)
		throw new Error("Malformed persisted binding status");
	return { ...value, content: value.content, title: value.title };
}

export function projectBindingStatusEntry(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || !isBindingStatusType(entry.customType))
		return entry;
	const status = readBindingStatus(entry.data);
	return {
		...entry,
		type: "custom_message",
		content: status.content,
		display: false,
		details: status,
	};
}

/** A status sample belongs to this runtime lifecycle, and is reusable only while visible. */
export async function recordBindingStatus(
	pi: Pick<ExtensionAPI, "appendEntry">,
	ctx: ExtensionContext,
	state: Pick<AdapterState, "bindingStatus">,
	kind: BindingStatusKind,
	messages: readonly AgentMessage[],
	codeMode: Pick<CodeModeRegistration, "notebookStatus" | "vmBindingStatus">,
): Promise<boolean> {
	const customType = BINDING_STATUS_TYPES[kind];
	const previous = state.bindingStatus;
	const previousVisible =
		previous?.kind === kind &&
		messages.some(
			(message) =>
				message.role === "custom" &&
				(message.customType === customType ||
					message.customType === CODEX_DEVELOPER_MESSAGE_TYPE) &&
				isCodexDeveloperMessageDetails(message.details) &&
				message.details.id === previous.id,
		);
	if (previousVisible) return false;
	ctx.signal?.throwIfAborted();
	const { content, title, reset } = await sampleBindingStatus(
		ctx,
		kind,
		codeMode,
	);
	if (!reset) ctx.signal?.throwIfAborted();
	const status: BindingStatus = {
		protocol: 1,
		id: randomUUID(),
		content,
		title,
	};
	// Durable at admission even during a live run; entry rendering owns the same UI notice.
	pi.appendEntry(customType, status);
	state.bindingStatus = { kind, id: status.id };
	// A reset that already cleared bindings needs a durable receipt even if this turn was cancelled.
	if (reset) ctx.signal?.throwIfAborted();
	return true;
}

async function sampleBindingStatus(
	ctx: ExtensionContext,
	kind: BindingStatusKind,
	codeMode: Pick<CodeModeRegistration, "notebookStatus" | "vmBindingStatus">,
): Promise<Pick<BindingStatus, "title" | "content"> & { reset?: boolean }> {
	try {
		if (kind === "vm") {
			const status = await codeMode.vmBindingStatus(ctx);
			return {
				title: `${EXECUTION_MODE_LABELS.vm} ${status.reset ? "reset" : "bindings"}`,
				...status,
			};
		}
		const status = await codeMode.notebookStatus(ctx);
		const inventory = status.details["startupStatus"] ?? status.message;
		const content = [status.details["startupNotice"], inventory]
			.filter((value) => typeof value === "string" && value)
			.join("\n");
		const title = [
			"TS",
			typeof status.details["retainedBindings"] === "number"
				? `${status.details["retainedBindings"]} retained`
				: undefined,
			typeof status.details["pinnedBindings"] === "number"
				? `${status.details["pinnedBindings"]} pinned`
				: undefined,
		]
			.filter(Boolean)
			.join(" · ");
		return { content, title };
	} catch (error) {
		if (ctx.signal?.aborted) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		return kind === "vm"
			? {
					title: `${EXECUTION_MODE_LABELS.vm} bindings unavailable`,
					content: `VM binding inventory unavailable: ${reason}`,
				}
			: {
					title: "TS status unavailable",
					content: `TS startup status unavailable: ${reason}\nUse notebook diagnostics to inspect the failure before relying on retained state`,
				};
	}
}
