import type {
	CustomMessageEntryDraft,
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { WindowIdentity } from "./bridge.js";

export const WINDOW_MESSAGE = "notes-compaction:window:v1";
export const SETTLEMENT_ENTRY = "notes-compaction:settled:v1";
export interface WindowDetails {
	protocol: 1;
	kind: "window" | "identity" | "reminder" | "urgent" | "task-boundary";
	identity: WindowIdentity;
	trim: boolean;
}
const GUIDANCE = `<context_window_guidance>
Notes are recovery state, not diary. Storage is virtual, not disk. Create relative paths.

MUST maintain one authoritative checkpoint per task/topic: request, constraints, decision, status, next steps and relevant history IDs.

Near a substantive turn's end, before replying, consolidate changed recovery state. notes write creates or replaces; append adds. Do not interleave saves with ordinary tool calls. Skip routine turns and unchanged state. Explicit reminders and earlier handoffs still apply.

Link existing notes rather than duplicate. Recording does not authorise implementation.

Immediately before new_context, MUST save the checkpoint via notes. Save before handoff too. For rollover, call new_context after saving.

After rollover, notes read recovers the checkpoint, then read only necessary links. Do not reread unchanged notes. Use history for missing details.

MUST reread required skills after rollover.
</context_window_guidance>`;

const GPT_GUIDANCE = `<context_window_guidance>
Notes=virtual recovery state, NOT disk/diary. Create relative paths. MUST maintain one authoritative checkpoint/task→request/constraints/decision/status/next steps/history IDs. Link existing notes≠duplicate; recording≠implementation permission.

Near substantive turn end, before reply→consolidate CHANGED recovery. notes write→create/replace; append→add. No saves amid ordinary tool calls; skip routine/unchanged state. Explicit reminders/earlier handoffs still apply.

Immediately before new_context MUST save checkpoint via notes; before handoff too. Rollover→new_context after save. After rollover: notes read→checkpoint→necessary links only; don't reread unchanged notes. Missing details→history.

After rollover MUST reread required skills.
</context_window_guidance>`;

export function registerWindowRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(
		WINDOW_MESSAGE,
		(message, { expanded, outputPad, keyHint }, theme) => {
			const details = parseWindowDetails(message.details);
			if (!details || typeof message.content !== "string") return undefined;
			const title =
				details.kind === "task-boundary"
					? "Task-boundary reminder"
					: details.kind === "urgent"
						? "Context nearly full · Save notes and start a new window now"
						: details.kind === "reminder"
							? "Context checkpoint reminder · Save notes and start a new window"
							: `Context window ${details.identity.windowNumber + 1} · Notes and history`;
			const box = new Box(outputPad, 1, (text) =>
				theme.bg("customMessageBg", text),
			);
			box.addChild(
				expanded
					? new Text(theme.fg("customMessageText", message.content), 0, 0)
					: new TruncatedText(
							theme.fg(
								details.kind === "urgent" ? "warning" : "customMessageLabel",
								title,
							) +
								theme.fg(
									"dim",
									` (${keyHint("app.tools.expand", "to expand")})`,
								),
							0,
							0,
						),
			);
			return box;
		},
	);
}

function identity(value: unknown): WindowIdentity | undefined {
	if (!value || typeof value !== "object") return;
	const data = value as Partial<WindowIdentity>;
	if (
		typeof data.firstWindowId !== "string" ||
		!data.firstWindowId ||
		typeof data.currentWindowId !== "string" ||
		!data.currentWindowId ||
		!Number.isInteger(data.windowNumber) ||
		data.windowNumber! < 0 ||
		(data.previousWindowId !== undefined &&
			typeof data.previousWindowId !== "string")
	)
		return;
	return data as WindowIdentity;
}

function parseWindowDetails(value: unknown): WindowDetails | undefined {
	if (!value || typeof value !== "object") return;
	const details = value as Partial<WindowDetails>;
	const ids = identity(details.identity);
	if (
		details.protocol !== 1 ||
		!ids ||
		!["window", "identity", "reminder", "urgent", "task-boundary"].includes(
			details.kind ?? "",
		) ||
		typeof details.trim !== "boolean"
	)
		return;
	return {
		protocol: 1,
		kind: details.kind!,
		identity: ids,
		trim: details.trim,
	};
}

/** Understand previous PCC window IDs for familiar history lookup, without importing its runtime. */
export function windowDetails(
	entry: SessionEntry | CustomMessageEntryDraft,
): WindowDetails | undefined {
	if (entry.type !== "custom_message") return;
	return messageWindowDetails(entry.customType, entry.details);
}

export function messageWindowDetails(
	customType: string,
	data: unknown,
): WindowDetails | undefined {
	if (customType === WINDOW_MESSAGE) return parseWindowDetails(data);
	if (
		customType !== "codex-context-window" ||
		!data ||
		typeof data !== "object" ||
		!("contextManagement" in data)
	)
		return;
	const details = data.contextManagement;
	if (
		!details ||
		typeof details !== "object" ||
		!("kind" in details) ||
		(details.kind !== "window" && details.kind !== "task-boundary")
	)
		return;
	const ids = identity(details);
	return ids
		? {
				protocol: 1,
				kind: details.kind,
				identity: ids,
				trim:
					"trimPreviousWindow" in details &&
					details.trimPreviousWindow === true,
			}
		: undefined;
}

export function windowMessage(
	ids: WindowIdentity,
	agent: string,
	hint: string,
	trim: boolean,
	kind: "window" | "identity" = "window",
	gpt = false,
): CustomMessageEntryDraft {
	const lines = [
		`Agent name: ${agent}`,
		`First context window id: ${ids.firstWindowId}`,
		`Current context window id: ${ids.currentWindowId}`,
	];
	if (ids.previousWindowId)
		lines.push(`Previous context window id: ${ids.previousWindowId}`);
	if (hint) lines.push(hint);
	return {
		type: "custom_message",
		customType: WINDOW_MESSAGE,
		content: `${gpt ? GPT_GUIDANCE : GUIDANCE}\n\n<context_window>\n${lines.join("\n")}\n</context_window>`,
		display: true,
		details: {
			protocol: 1,
			kind,
			identity: ids,
			trim,
		} satisfies WindowDetails,
	};
}
