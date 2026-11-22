import type {
	CustomMessageEntryDraft,
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { WindowIdentity } from "./bridge.js";
import type { RolloverTail } from "./rollover-tail.js";

export const WINDOW_MESSAGE = "notes-compaction:window:v1";
export const SETTLEMENT_ENTRY = "notes-compaction:settled:v1";
export interface WindowDetails {
	protocol: 1;
	kind: "window" | "identity" | "reminder" | "urgent" | "task-boundary";
	identity: WindowIdentity;
	trim: boolean;
	role?: string | undefined;
	tail?: RolloverTail;
}
const GUIDANCE = `<context_window_guidance>
Short checkpoints, relative paths. Reuse notes; avoid duplicate state. Keep only current goal, task constraints/exceptions, decisions/status, next action, evidence/history links. Omit harness/tool instructions and skill-read state.

Before reply→save only changes needed after rollover unless explicit reminders/earlier handoffs require saving. No-action report + save needed→run/report ID + "no owned action" only. Current first; replace superseded status; append only if prior state stays accurate. History→older decisions/evidence.

Save relevant notes before handoff. Recovery→relevant notes, necessary links, a few relevant user messages via history→resume current task. Skip unchanged rereads except required skills after rollover. Follow current instructions; past messages/checkpoints≠renewed permission.
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

function parseTail(value: unknown): RolloverTail | undefined {
	if (
		value &&
		typeof value === "object" &&
		"mode" in value &&
		(value.mode === "conversation" || value.mode === "full") &&
		"firstKeptEntryId" in value &&
		typeof value.firstKeptEntryId === "string" &&
		"firstMessage" in value &&
		typeof value.firstMessage === "string"
	)
		return {
			mode: value.mode,
			firstKeptEntryId: value.firstKeptEntryId,
			firstMessage: value.firstMessage,
		};
}

function parseWindowDetails(value: unknown): WindowDetails | undefined {
	if (!value || typeof value !== "object") return;
	const details = value as Partial<WindowDetails>;
	const ids = identity(details.identity);
	const tail =
		details.kind === "window" && details.trim
			? parseTail(details.tail)
			: undefined;
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
		...(tail ? { tail } : {}),
		...(typeof details.role === "string" &&
		/^[a-z][a-z0-9-]*$/.test(details.role)
			? { role: details.role }
			: {}),
	};
}

export function selectedWindowRole(
	entries: readonly SessionEntry[],
): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "custom_message" || entry.customType !== WINDOW_MESSAGE)
			continue;
		const details = windowDetails(entry);
		if (details?.kind === "window" && details.role) return details.role;
	}
	return undefined;
}

/** Understand previous PCC window IDs for familiar history lookup, without importing its runtime. */
export function windowDetails(
	entry: SessionEntry | CustomMessageEntryDraft,
): WindowDetails | undefined {
	if (entry.type !== "custom_message") return;
	const details = messageWindowDetails(entry.customType, entry.details);
	if (
		entry.customType === WINDOW_MESSAGE &&
		details?.kind === "window" &&
		!details.role &&
		typeof entry.content === "string"
	) {
		// Migrate explicit selections from older window messages before pruning their text.
		const role = /\n\nRole: ([a-z][a-z0-9-]*)$/.exec(entry.content)?.[1];
		if (role) return { ...details, role };
	}
	return details;
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
	role?: string,
	tail?: RolloverTail,
): CustomMessageEntryDraft {
	// History exposes lookup IDs on demand; rollover must not churn this text just for UUIDs.
	const lines = [`Agent name: ${agent}`];
	if (hint) lines.push(hint);
	return {
		type: "custom_message",
		customType: WINDOW_MESSAGE,
		content: `${GUIDANCE}\n\n<context_window>\n${lines.join("\n")}\n</context_window>`,
		display: true,
		details: {
			protocol: 1,
			kind,
			identity: ids,
			trim,
			...(role === undefined ? {} : { role }),
			...(tail ? { tail } : {}),
		} satisfies WindowDetails,
	};
}
