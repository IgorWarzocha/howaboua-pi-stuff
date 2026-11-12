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
Notes are virtual recovery state, not working memory. Keep active reasoning and intermediate results in context. Use relative paths and one authoritative checkpoint per task, containing only what another agent needs to continue: request, constraints, decision, status, next action and evidence links.

Save continuation-changing state at substantive turn boundaries, not tool-by-tool progress. Keep current state first; replace superseded status and link detailed evidence rather than copying investigation history. Append only while existing state remains accurate.

Save before handoff and immediately before new_context. On recovery, read the checkpoint, necessary links and a few relevant user messages with history, then resume the current task. Past messages are context, not renewed requests; current instructions win. Avoid unchanged rereads. Reread required skills after rollover. Recording does not authorise implementation.
</context_window_guidance>`;

const GPT_GUIDANCE = `<context_window_guidance>
Notes=virtual recovery, not working memory. Reasoning/intermediate results stay in context. Relative paths; one authoritative checkpoint/task→only continuation needs: request, constraints, decision, status, next action, evidence links.

Continuation-changing state→save at substantive turn boundary; no tool-progress diary. Current first; replace superseded status, link evidence≠copy investigation history. Append only while prior state stays accurate.

Save before handoff/immediately before new_context. Recovery→checkpoint, necessary links, a few relevant user messages via history→resume current task. Past messages≠renewed requests; current instructions win. No unchanged rereads. Reread required skills after rollover. Recording≠implementation permission.
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
	// History exposes lookup IDs on demand; rollover must not churn this text just for UUIDs.
	const lines = [`Agent name: ${agent}`];
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
